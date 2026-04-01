#pragma once

#include "obs-graphics-manager.hpp"

#include <QVariant>
#include <QObject>
#include <QJsonObject>

class AiGraphicsBridge : public QObject {
    Q_OBJECT

public:
    explicit AiGraphicsBridge(QObject *parent = nullptr);

    Q_INVOKABLE QVariantMap bootstrap() const;
    Q_INVOKABLE QVariantMap loadState() const;
    Q_INVOKABLE QVariantMap saveRuntimeConfig(bool testingMode, int seasonRefreshMinutes);
    Q_INVOKABLE QVariantMap saveGeneratedGraphic(const QString &graphicId,
                                                const QString &dataUrl,
                                                const QString &prompt,
                                                const QString &season,
                                                const QString &qualityNotes,
                                                bool visible,
                                                int generationAttempt,
                                                int reviewScore);
    Q_INVOKABLE QVariantMap saveSeason(const QString &season, const QString &reasoning);
    Q_INVOKABLE QVariantMap applyToScene();
    Q_INVOKABLE QVariantMap setGraphicVisibility(const QString &graphicId, bool visible);

signals:
    void stateChanged(const QString &jsonState);
    void info(const QString &message);
    void error(const QString &message);

private:
    QString moduleDataPath() const;
    QString generatedGraphicsDir() const;
    QString manifestPath() const;
    QJsonObject loadManifestObject() const;
    bool saveManifestObject(const QJsonObject &manifest) const;
    QVariantList inspirationAssets() const;
    QVariantMap toResponse(bool ok, const QString &message, const QJsonObject &payload = {}) const;
    QString dataUrlToFile(const QString &graphicId, const QString &dataUrl) const;

    ObsGraphicsManager obsManager_;
};
