cmake_minimum_required(VERSION 3.28...3.30)

project(obs-ai-broadcast-graphics VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

find_package(libobs REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel)

add_library(${PROJECT_NAME} MODULE
    src/plugin-main.cpp
    src/ai-graphics-bridge.cpp
    src/ai-graphics-dock.cpp
    src/obs-graphics-manager.cpp
)

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    OBS::libobs
    OBS::frontend-api
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::WebEngineWidgets
    Qt6::WebChannel
)

if(MSVC)
    target_compile_definitions(${PROJECT_NAME} PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "obs-ai-broadcast-graphics"
)

install(TARGETS ${PROJECT_NAME}
    LIBRARY DESTINATION obs-plugins/64bit
    RUNTIME DESTINATION obs-plugins/64bit
)

install(DIRECTORY ui/
    DESTINATION data/obs-plugins/obs-ai-broadcast-graphics/ui
)

install(FILES data/locale/en-US.ini
    DESTINATION data/obs-plugins/obs-ai-broadcast-graphics/locale
)
