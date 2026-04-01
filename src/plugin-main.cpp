#include "ai-graphics-dock.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QMainWindow>
#include <memory>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("obs-ai-broadcast-graphics", "en-US")

MODULE_EXPORT const char *obs_module_description(void)
{
    return "AI-powered broadcast graphics dock for OBS Studio using Puter.js.";
}

namespace {
std::unique_ptr<AiGraphicsDock> g_dock;
constexpr auto kDockId = "obs-ai-broadcast-graphics.dock";
}

bool obs_module_load(void)
{
    auto *mainWindow = static_cast<QMainWindow *>(obs_frontend_get_main_window());
    if (!mainWindow) {
        blog(LOG_ERROR, "[obs-ai-broadcast-graphics] Could not resolve OBS main window.");
        return false;
    }

    g_dock = std::make_unique<AiGraphicsDock>(mainWindow);
    if (!obs_frontend_add_dock_by_id(kDockId, "AI Broadcast Graphics", g_dock.get())) {
        blog(LOG_ERROR, "[obs-ai-broadcast-graphics] Failed to register dock.");
        g_dock.reset();
        return false;
    }

    blog(LOG_INFO, "[obs-ai-broadcast-graphics] Plugin loaded.");
    return true;
}

void obs_module_unload(void)
{
    obs_frontend_remove_dock(kDockId);
    g_dock.reset();
    blog(LOG_INFO, "[obs-ai-broadcast-graphics] Plugin unloaded.");
}
