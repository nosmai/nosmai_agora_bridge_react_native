cmake_minimum_required(VERSION 3.13)
project(nosmai_agora_bridge CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(SHARED_CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp)

add_library(nosmai_agora_bridge SHARED
    ${SHARED_CPP_DIR}/NosmaiAgoraPush.cpp
    src/main/jni/NosmaiAgoraJni.cpp
)

target_include_directories(nosmai_agora_bridge PRIVATE ${SHARED_CPP_DIR})
# Agora's public headers, vendored at the pinned SDK version. SYSTEM keeps
# their own warnings out of our build.
target_include_directories(nosmai_agora_bridge SYSTEM PRIVATE
    ${SHARED_CPP_DIR}/third_party)

target_compile_options(nosmai_agora_bridge PRIVATE -Wall -Wextra -fvisibility=hidden)

# Deliberately no Agora library here: every call is a virtual call through a
# pointer react-native-agora's already-loaded engine hands us.
find_library(log-lib log)
target_link_libraries(nosmai_agora_bridge ${log-lib})
