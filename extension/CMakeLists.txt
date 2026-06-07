cmake_minimum_required(VERSION 3.20)

project(ArmaMCP_x64 LANGUAGES CXX)

option(ARMA_MCP_PREFER_STATIC_RUNTIME "Prefer statically linked compiler runtimes for packaged extension builds" ON)

add_library(ArmaMCP_x64 SHARED src/ArmaMCP.cpp)
target_compile_features(ArmaMCP_x64 PRIVATE cxx_std_17)
target_compile_definitions(ArmaMCP_x64 PRIVATE ARMA_MCP_EXTENSION)

if(ARMA_MCP_PREFER_STATIC_RUNTIME)
  if(MSVC)
    set_property(TARGET ArmaMCP_x64 PROPERTY
      MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  elseif(MINGW)
    target_link_options(ArmaMCP_x64 PRIVATE
      -static
      -static-libgcc
      -static-libstdc++
      -Wl,--exclude-libs,ALL)
  elseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_link_options(ArmaMCP_x64 PRIVATE
      -static-libgcc
      -static-libstdc++)
  endif()
endif()

if(WIN32)
  target_link_libraries(ArmaMCP_x64 PRIVATE ws2_32)
  set_target_properties(ArmaMCP_x64 PROPERTIES PREFIX "" SUFFIX ".dll")
else()
  target_link_libraries(ArmaMCP_x64 PRIVATE dl)
  set_target_properties(ArmaMCP_x64 PROPERTIES PREFIX "" SUFFIX ".so")
endif()
