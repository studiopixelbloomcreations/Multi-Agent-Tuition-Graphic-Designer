#include "obs-graphics-manager.hpp"

#include "graphics-types.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QFileInfo>

namespace {
const GraphicSlot *find_slot(const QString &graphicId)
{
    static const QVector<GraphicSlot> slots = graphics_slots();
    for (const auto &slot : slots) {
        if (slot.id == graphicId) {
            return &slot;
        }
    }
    return nullptr;
}

void configure_scene_item(obs_sceneitem_t *item, const GraphicSlot &slot, bool visible)
{
    vec2 position = {slot.x, slot.y};
    vec2 bounds = {slot.width, slot.height};
    obs_sceneitem_set_pos(item, &position);
    obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
    obs_sceneitem_set_bounds(item, &bounds);
    obs_sceneitem_set_alignment(item, OBS_ALIGN_LEFT | OBS_ALIGN_TOP);
    obs_sceneitem_set_bounds_alignment(item, OBS_ALIGN_LEFT | OBS_ALIGN_TOP);
    obs_sceneitem_set_visible(item, visible);
}
}

bool ObsGraphicsManager::applyManifestToCurrentScene(const QJsonObject &manifest, QString &error) const
{
    auto sceneSource = obs_frontend_get_current_scene();
    if (!sceneSource) {
        error = "No active OBS scene is available.";
        return false;
    }

    auto *scene = obs_scene_from_source(sceneSource);
    if (!scene) {
        obs_source_release(sceneSource);
        error = "Failed to resolve the current OBS scene.";
        return false;
    }

    const auto assets = manifest.value("assets").toObject();
    for (const auto &slot : graphics_slots()) {
        const auto asset = assets.value(slot.id).toObject();
        const auto filePath = asset.value("path").toString();
        if (filePath.isEmpty() || !QFileInfo::exists(filePath)) {
            continue;
        }

        obs_data_t *settings = obs_data_create();
        obs_data_set_string(settings, "file", filePath.toUtf8().constData());
        obs_data_set_bool(settings, "unload", false);
        obs_data_set_bool(settings, "linear_alpha", true);

        obs_source_t *source = obs_get_source_by_name(slot.sourceName.toUtf8().constData());
        if (source) {
            obs_source_update(source, settings);
        } else {
            source = obs_source_create("image_source", slot.sourceName.toUtf8().constData(), settings, nullptr);
        }
        obs_data_release(settings);

        if (!source) {
            obs_source_release(sceneSource);
            error = QString("Could not create image source for %1.").arg(slot.id);
            return false;
        }

        obs_sceneitem_t *item = obs_scene_find_source(scene, slot.sourceName.toUtf8().constData());
        if (!item) {
            item = obs_scene_add(scene, source);
        }

        if (!item) {
            obs_source_release(source);
            obs_source_release(sceneSource);
            error = QString("Could not add %1 to the current scene.").arg(slot.id);
            return false;
        }

        configure_scene_item(item, slot, asset.value("visible").toBool(slot.visibleByDefault));
        obs_source_release(source);
    }

    obs_source_release(sceneSource);
    obs_frontend_save();
    return true;
}

bool ObsGraphicsManager::setGraphicVisibility(const QString &graphicId, bool visible, QString &error) const
{
    auto sceneSource = obs_frontend_get_current_scene();
    if (!sceneSource) {
        error = "No active OBS scene is available.";
        return false;
    }

    auto *scene = obs_scene_from_source(sceneSource);
    const auto *slot = find_slot(graphicId);
    if (!scene || !slot) {
        obs_source_release(sceneSource);
        error = "Could not resolve the graphic slot or current scene.";
        return false;
    }

    auto *item = obs_scene_find_source(scene, slot->sourceName.toUtf8().constData());
    if (!item) {
        obs_source_release(sceneSource);
        error = "The requested graphic source has not been added to the current scene yet.";
        return false;
    }

    obs_sceneitem_set_visible(item, visible);
    obs_source_release(sceneSource);
    obs_frontend_save();
    return true;
}
