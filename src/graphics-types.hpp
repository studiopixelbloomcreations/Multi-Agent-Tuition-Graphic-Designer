#pragma once

#include <QString>
#include <QVector>

struct GraphicSlot {
    QString id;
    QString sourceName;
    QString fileName;
    float x;
    float y;
    float width;
    float height;
    bool visibleByDefault;
};

inline QVector<GraphicSlot> graphics_slots()
{
    return {
        {"intro-lower-third", "AI Graphics - Intro Lower Third", "intro-lower-third.png", 72.0f, 1760.0f, 1680.0f, 340.0f, true},
        {"always-on-lower-third", "AI Graphics - Always-On Lower Third", "always-on-lower-third.png", 72.0f, 1840.0f, 1400.0f, 240.0f, true},
        {"live-badge", "AI Graphics - Live Badge", "live-badge.png", 3230.0f, 72.0f, 520.0f, 240.0f, true},
        {"institution-banner", "AI Graphics - Institution Banner", "institution-banner.png", 0.0f, 1760.0f, 3840.0f, 320.0f, true},
    };
}
