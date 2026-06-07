cmake_minimum_required(VERSION 3.20)

project(ArmaMCP_x64 LANGUAGES CXX)

add_library(ArmaMCP_x64 SHARED src/ArmaMCP.cpp)
target_compile_features(ArmaMCP_x64 PRIVATE cxx_std_17)
target_compile_definitions(ArmaMCP_x64 PRIVATE ARMA_MCP_EXTENSION)

if(WIN32)
  target_link_libraries(ArmaMCP_x64 PRIVATE ws2_32)
  set_target_properties(ArmaMCP_x64 PROPERTIES PREFIX "" SUFFIX ".dll")
else()
  set_target_properties(ArmaMCP_x64 PROPERTIES PREFIX "" SUFFIX ".so")
endif()
