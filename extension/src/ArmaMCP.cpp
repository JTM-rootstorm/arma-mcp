#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <windows.h>
#include <ws2tcpip.h>
using socket_handle = SOCKET;
constexpr socket_handle invalid_socket_handle = INVALID_SOCKET;
static void close_socket(socket_handle socket) { closesocket(socket); }
#define AMCP_EXPORT extern "C" __declspec(dllexport)
#define AMCP_CALL __stdcall
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <dlfcn.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_handle = int;
constexpr socket_handle invalid_socket_handle = -1;
static void close_socket(socket_handle socket) { close(socket); }
#define AMCP_EXPORT extern "C" __attribute__((visibility("default")))
#define AMCP_CALL
#endif

namespace {

constexpr int kConnectTimeoutMs = 50;
constexpr int kIoTimeoutMs = 500;
constexpr int kInitialBridgeRetryDelayMs = 1000;
constexpr int kMaxBridgeRetryDelayMs = 5000;
constexpr int kMaxResponseBytes = 256 * 1024;

struct Config {
    std::string host = "127.0.0.1";
    int port = 38473;
    std::string token;
};

struct HttpResponse {
    int status = 0;
    std::string body;
    std::string error;
};

struct BridgeRetryState {
    int failures = 0;
    std::chrono::steady_clock::time_point next_attempt = std::chrono::steady_clock::time_point::min();
};

BridgeRetryState &bridge_retry_state() {
    static BridgeRetryState state;
    return state;
}

bool is_transient_bridge_error(const std::string &error) {
    return error == "bridge_unavailable" || error == "bridge_timeout" || error == "send_failed" ||
           error == "empty_response";
}

bool bridge_retry_pending(std::string &error) {
    BridgeRetryState &state = bridge_retry_state();
    if (state.failures <= 0) {
        return false;
    }

    if (std::chrono::steady_clock::now() >= state.next_attempt) {
        return false;
    }

    error = "bridge_retry_pending";
    return true;
}

void mark_bridge_success() {
    BridgeRetryState &state = bridge_retry_state();
    state.failures = 0;
    state.next_attempt = std::chrono::steady_clock::time_point::min();
}

void mark_bridge_failure(const std::string &error) {
    if (!is_transient_bridge_error(error)) {
        return;
    }

    BridgeRetryState &state = bridge_retry_state();
    state.failures = std::min(state.failures + 1, 6);
    const int multiplier = 1 << std::min(state.failures - 1, 3);
    const int delay_ms = std::min(kInitialBridgeRetryDelayMs * multiplier, kMaxBridgeRetryDelayMs);
    state.next_attempt = std::chrono::steady_clock::now() + std::chrono::milliseconds(delay_ms);
}

std::string trim(std::string value) {
    auto not_space = [](unsigned char character) { return std::isspace(character) == 0; };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
    value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
    return value;
}

std::string dirname_of(const std::string &path) {
    const size_t slash = path.find_last_of("/\\");
    if (slash == std::string::npos) {
        return ".";
    }
    return path.substr(0, slash);
}

std::string module_directory() {
#ifdef _WIN32
    char path[MAX_PATH] = {};
    HMODULE module = nullptr;
    if (GetModuleHandleExA(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            reinterpret_cast<LPCSTR>(&module_directory),
            &module
        ) &&
        GetModuleFileNameA(module, path, static_cast<DWORD>(sizeof(path))) > 0) {
        return dirname_of(path);
    }
#else
    Dl_info info{};
    if (dladdr(reinterpret_cast<void *>(&module_directory), &info) != 0 && info.dli_fname != nullptr) {
        return dirname_of(info.dli_fname);
    }
#endif
    return ".";
}

void apply_config_file(Config &config, const std::string &path) {
    std::ifstream input(path);
    if (!input) {
        return;
    }

    std::string line;
    while (std::getline(input, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#' || line[0] == ';') {
            continue;
        }

        const size_t separator = line.find('=');
        if (separator == std::string::npos) {
            continue;
        }

        const std::string key = trim(line.substr(0, separator));
        const std::string value = trim(line.substr(separator + 1));

        if (key == "host" && !value.empty()) {
            config.host = value;
        } else if (key == "port" && !value.empty()) {
            config.port = std::max(1, std::atoi(value.c_str()));
        } else if (key == "token") {
            config.token = value;
        }
    }
}

Config read_config() {
    Config config;
    if (const char *host = std::getenv("ARMA_MCP_HOST")) {
        config.host = host;
    }
    if (const char *port = std::getenv("ARMA_MCP_PORT")) {
        config.port = std::max(1, std::atoi(port));
    }
    if (const char *token = std::getenv("ARMA_MCP_TOKEN")) {
        config.token = token;
    }
    apply_config_file(config, module_directory() + "/ArmaMCP.ini");
    return config;
}

#ifdef _WIN32
bool ensure_winsock() {
    static bool initialized = [] {
        WSADATA data;
        return WSAStartup(MAKEWORD(2, 2), &data) == 0;
    }();
    return initialized;
}
#endif

bool set_nonblocking(socket_handle socket, bool nonblocking) {
#ifdef _WIN32
    u_long mode = nonblocking ? 1UL : 0UL;
    return ioctlsocket(socket, FIONBIO, &mode) == 0;
#else
    int flags = fcntl(socket, F_GETFL, 0);
    if (flags < 0) {
        return false;
    }
    if (nonblocking) {
        flags |= O_NONBLOCK;
    } else {
        flags &= ~O_NONBLOCK;
    }
    return fcntl(socket, F_SETFL, flags) == 0;
#endif
}

void set_socket_timeouts(socket_handle socket, int timeout_ms) {
#ifdef _WIN32
    DWORD timeout = static_cast<DWORD>(timeout_ms);
    setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&timeout), sizeof(timeout));
    setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char *>(&timeout), sizeof(timeout));
#else
    timeval timeout{};
    timeout.tv_sec = 0;
    timeout.tv_usec = timeout_ms * 1000;
    setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
#endif
}

bool wait_for_socket(socket_handle socket, bool write, int timeout_ms) {
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(socket, &fds);
    timeval timeout{};
    timeout.tv_sec = 0;
    timeout.tv_usec = timeout_ms * 1000;
    int result = select(static_cast<int>(socket + 1), write ? nullptr : &fds, write ? &fds : nullptr, nullptr, &timeout);
    return result > 0;
}

bool socket_connect_succeeded(socket_handle socket, std::string &error) {
#ifdef _WIN32
    int socket_error = 0;
    int length = sizeof(socket_error);
    if (getsockopt(socket, SOL_SOCKET, SO_ERROR, reinterpret_cast<char *>(&socket_error), &length) != 0) {
        error = "bridge_unavailable";
        return false;
    }
#else
    int socket_error = 0;
    socklen_t length = sizeof(socket_error);
    if (getsockopt(socket, SOL_SOCKET, SO_ERROR, &socket_error, &length) != 0) {
        error = "bridge_unavailable";
        return false;
    }
#endif

    if (socket_error != 0) {
        error = "bridge_unavailable";
        return false;
    }

    return true;
}

socket_handle connect_localhost(const Config &config, std::string &error) {
#ifdef _WIN32
    if (!ensure_winsock()) {
        error = "winsock_init_failed";
        return invalid_socket_handle;
    }
#endif

    socket_handle socket = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket == invalid_socket_handle) {
        error = "socket_failed";
        return invalid_socket_handle;
    }

    set_socket_timeouts(socket, kIoTimeoutMs);
    set_nonblocking(socket, true);

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<unsigned short>(config.port));
    if (inet_pton(AF_INET, config.host.c_str(), &address.sin_addr) != 1) {
        error = "invalid_host";
        close_socket(socket);
        return invalid_socket_handle;
    }

    int result = ::connect(socket, reinterpret_cast<sockaddr *>(&address), sizeof(address));
    if (result != 0) {
#ifdef _WIN32
        int code = WSAGetLastError();
        if (code != WSAEWOULDBLOCK && code != WSAEINPROGRESS) {
#else
        if (errno != EINPROGRESS) {
#endif
            error = "bridge_unavailable";
            close_socket(socket);
            return invalid_socket_handle;
        }
        if (!wait_for_socket(socket, true, kConnectTimeoutMs)) {
            error = "bridge_timeout";
            close_socket(socket);
            return invalid_socket_handle;
        }
        if (!socket_connect_succeeded(socket, error)) {
            close_socket(socket);
            return invalid_socket_handle;
        }
    }

    set_nonblocking(socket, false);
    return socket;
}

bool send_all(socket_handle socket, const std::string &request) {
    const char *data = request.data();
    size_t remaining = request.size();
    while (remaining > 0) {
        int sent = send(socket, data, static_cast<int>(remaining), 0);
        if (sent <= 0) {
            return false;
        }
        data += sent;
        remaining -= static_cast<size_t>(sent);
    }
    return true;
}

HttpResponse http_request(const std::string &method, const std::string &path, const std::string &body, bool auth) {
    Config config = read_config();
    if (auth && config.token.empty()) {
        return {.status = 0, .body = "", .error = "missing_token"};
    }

    std::string error;
    if (bridge_retry_pending(error)) {
        return {.status = 0, .body = "", .error = error};
    }

    socket_handle socket = connect_localhost(config, error);
    if (socket == invalid_socket_handle) {
        mark_bridge_failure(error);
        return {.status = 0, .body = "", .error = error};
    }

    std::ostringstream request;
    request << method << " " << path << " HTTP/1.1\r\n";
    request << "Host: " << config.host << ":" << config.port << "\r\n";
    request << "Connection: close\r\n";
    request << "Accept: application/json\r\n";
    if (auth) {
        request << "Authorization: Bearer " << config.token << "\r\n";
    }
    if (!body.empty()) {
        request << "Content-Type: application/json\r\n";
    }
    request << "Content-Length: " << body.size() << "\r\n\r\n";
    request << body;

    if (!send_all(socket, request.str())) {
        close_socket(socket);
        mark_bridge_failure("send_failed");
        return {.status = 0, .body = "", .error = "send_failed"};
    }

    std::string raw;
    std::vector<char> buffer(4096);
    while (raw.size() < kMaxResponseBytes) {
        int received = recv(socket, buffer.data(), static_cast<int>(buffer.size()), 0);
        if (received <= 0) {
            break;
        }
        raw.append(buffer.data(), static_cast<size_t>(received));
    }
    close_socket(socket);

    if (raw.empty()) {
        mark_bridge_failure("empty_response");
        return {.status = 0, .body = "", .error = "empty_response"};
    }

    std::istringstream status_line(raw.substr(0, raw.find("\r\n")));
    std::string http_version;
    int status = 0;
    status_line >> http_version >> status;

    std::string body_out;
    size_t body_start = raw.find("\r\n\r\n");
    if (body_start != std::string::npos) {
        body_out = raw.substr(body_start + 4);
    }

    if (status < 200 || status > 299) {
        return {.status = status, .body = body_out, .error = "http_" + std::to_string(status)};
    }

    mark_bridge_success();
    return {.status = status, .body = body_out, .error = ""};
}

std::string handle_command(const std::string &command) {
    if (command == "ping") {
        HttpResponse response = http_request("GET", "/health", "", false);
        if (!response.error.empty()) {
            return "ERR:" + response.error;
        }
        return "OK:" + response.body;
    }

    if (command == "pollCommands") {
        HttpResponse response = http_request("GET", "/bridge/commands", "", true);
        if (!response.error.empty()) {
            return "ERR:" + response.error;
        }
        return "OK:" + response.body;
    }

    const auto colon = command.find(':');
    const std::string verb = colon == std::string::npos ? command : command.substr(0, colon);
    const std::string payload = colon == std::string::npos ? "" : command.substr(colon + 1);

    std::string path;
    if (verb == "postSnapshot") {
        path = "/bridge/snapshot";
    } else if (verb == "postResult") {
        path = "/bridge/result";
    } else if (verb == "postEvent") {
        path = "/bridge/event";
    } else {
        return "ERR:unknown_command";
    }

    HttpResponse response = http_request("POST", path, payload, true);
    if (!response.error.empty()) {
        return "ERR:" + response.error;
    }
    return "OK:" + response.body;
}

void copy_output(char *output, int output_size, const std::string &text) {
    if (output == nullptr || output_size <= 0) {
        return;
    }
    const size_t max_copy = static_cast<size_t>(output_size - 1);
    const size_t copy_size = std::min(max_copy, text.size());
    std::memcpy(output, text.data(), copy_size);
    output[copy_size] = '\0';
}

} // namespace

AMCP_EXPORT void AMCP_CALL RVExtension(char *output, int outputSize, const char *function) {
    copy_output(output, outputSize, handle_command(function == nullptr ? "" : function));
}

AMCP_EXPORT int AMCP_CALL RVExtensionArgs(
    char *output,
    int outputSize,
    const char *function,
    const char **args,
    int argsCnt
) {
    std::string command = function == nullptr ? "" : function;
    if (argsCnt > 0 && args != nullptr && args[0] != nullptr) {
        command += ":";
        command += args[0];
    }
    copy_output(output, outputSize, handle_command(command));
    return 0;
}

AMCP_EXPORT void AMCP_CALL RVExtensionVersion(char *output, int outputSize) {
    copy_output(output, outputSize, "ArmaMCP_x64 0.1.0");
}
