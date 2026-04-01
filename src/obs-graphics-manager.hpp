#pragma once

#include <QJsonObject>
#include <QString>

class ObsGraphicsManager {
public:
    bool applyManifestToCurrentScene(const QJsonObject &manifest, QString &error) const;
    bool setGraphicVisibility(const QString &graphicId, bool visible, QString &error) const;
};
