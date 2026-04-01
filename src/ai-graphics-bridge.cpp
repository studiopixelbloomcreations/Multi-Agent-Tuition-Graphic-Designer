#include "ai-graphics-bridge.hpp"

#include "graphics-types.hpp"

#include <obs-module.h>

#include <QByteArray>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPainter>
#include <QPoint>
#include <QSize>
#include <QUrl>

namespace {
QString file_to_data_url(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return {};
    }

    const auto bytes = file.readAll().toBase64();
    const auto suffix = QFileInfo(path).suffix().toLower();
    const auto mime = suffix == "png" ? "image/png" : "image/gif";
    return QString("data:%1;base64,%2").arg(mime, QString::fromLatin1(bytes));
}

QJsonObject default_manifest()
{
    QJsonObject root;
    root["season"] = "Default";
    root["updatedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    root["seasonReasoning"] = "No season analysis yet.";
    root["seasonCheckedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    root["testingMode"] = true;
    root["seasonRefreshMinutes"] = 30;
    root["assets"] = QJsonObject {};
    return root;
}

const GraphicSlot *slot_for(const QString &graphicId)
{
    static const auto slots = graphics_slots();
    for (const auto &slot : slots) {
        if (slot.id == graphicId) {
            return &slot;
        }
    }
    return nullptr;
}
}

AiGraphicsBridge::AiGraphicsBridge(QObject *parent)
    : QObject(parent)
{
    QDir().mkpath(generatedGraphicsDir());
}

QVariantMap AiGraphicsBridge::bootstrap() const
{
    QVariantMap payload;
    payload.insert("moduleDataPath", moduleDataPath());
    payload.insert("generatedGraphicsDir", generatedGraphicsDir());
    payload.insert("state", loadState());
    payload.insert("inspirationAssets", inspirationAssets());
    return payload;
}

QVariantMap AiGraphicsBridge::loadState() const
{
    return toResponse(true, "State loaded.", loadManifestObject());
}

QVariantMap AiGraphicsBridge::saveRuntimeConfig(bool testingMode, int seasonRefreshMinutes)
{
    auto manifest = loadManifestObject();
    manifest["testingMode"] = testingMode;
    manifest["seasonRefreshMinutes"] = seasonRefreshMinutes;
    manifest["updatedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);

    if (!saveManifestObject(manifest)) {
        return toResponse(false, "Failed to persist runtime config.");
    }

    emit stateChanged(QString::fromUtf8(QJsonDocument(manifest).toJson(QJsonDocument::Compact)));
    return toResponse(true, "Runtime config saved.", manifest);
}

QVariantMap AiGraphicsBridge::saveGeneratedGraphic(const QString &graphicId,
                                                   const QString &dataUrl,
                                                   const QString &prompt,
                                                   const QString &season,
                                                   const QString &qualityNotes,
                                                   bool visible,
                                                   int generationAttempt,
                                                   int reviewScore)
{
    const auto *slot = slot_for(graphicId);
    if (!slot) {
        return toResponse(false, "Unknown graphic slot.");
    }

    const auto filePath = dataUrlToFile(graphicId, dataUrl);
    if (filePath.isEmpty()) {
        emit error("Failed to save generated graphic.");
        return toResponse(false, "Failed to decode generated image.");
    }

    auto manifest = loadManifestObject();
    manifest["season"] = season;
    manifest["updatedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);

    auto assets = manifest.value("assets").toObject();
    QJsonObject asset;
    asset["id"] = slot->id;
    asset["path"] = filePath;
    asset["prompt"] = prompt;
    asset["qualityNotes"] = qualityNotes;
    asset["visible"] = visible;
    asset["savedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    asset["width"] = 3840;
    asset["height"] = 2160;
    asset["generationAttempt"] = generationAttempt;
    asset["reviewScore"] = reviewScore;
    asset["overwriteMode"] = true;
    asset["version"] = assets.value(graphicId).toObject().value("version").toInt(0) + 1;
    assets[graphicId] = asset;
    manifest["assets"] = assets;

    if (!saveManifestObject(manifest)) {
        emit error("Failed to write the generated graphics manifest.");
        return toResponse(false, "Failed to update generated graphics manifest.");
    }

    emit stateChanged(QString::fromUtf8(QJsonDocument(manifest).toJson(QJsonDocument::Compact)));
    emit info(QString("Saved %1 to %2").arg(graphicId, filePath));
    return toResponse(true, "Graphic saved.", manifest);
}

QVariantMap AiGraphicsBridge::saveSeason(const QString &season, const QString &reasoning)
{
    auto manifest = loadManifestObject();
    manifest["season"] = season;
    manifest["seasonReasoning"] = reasoning;
    manifest["seasonCheckedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    manifest["updatedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);

    if (!saveManifestObject(manifest)) {
        return toResponse(false, "Failed to persist season state.");
    }

    emit stateChanged(QString::fromUtf8(QJsonDocument(manifest).toJson(QJsonDocument::Compact)));
    return toResponse(true, "Season saved.", manifest);
}

QVariantMap AiGraphicsBridge::applyToScene()
{
    const auto manifest = loadManifestObject();
    QString errorMessage;
    if (!obsManager_.applyManifestToCurrentScene(manifest, errorMessage)) {
        emit error(errorMessage);
        return toResponse(false, errorMessage);
    }

    emit info("Generated graphics applied to the current OBS scene.");
    return toResponse(true, "Graphics applied to the current scene.", manifest);
}

QVariantMap AiGraphicsBridge::setGraphicVisibility(const QString &graphicId, bool visible)
{
    auto manifest = loadManifestObject();
    auto assets = manifest.value("assets").toObject();
    auto asset = assets.value(graphicId).toObject();
    asset["visible"] = visible;
    assets[graphicId] = asset;
    manifest["assets"] = assets;
    saveManifestObject(manifest);

    QString errorMessage;
    if (!obsManager_.setGraphicVisibility(graphicId, visible, errorMessage)) {
        return toResponse(false, errorMessage, manifest);
    }

    emit stateChanged(QString::fromUtf8(QJsonDocument(manifest).toJson(QJsonDocument::Compact)));
    return toResponse(true, "Graphic visibility updated.", manifest);
}

QString AiGraphicsBridge::moduleDataPath() const
{
    char *modulePath = obs_module_file("");
    const QString path = QString::fromUtf8(modulePath ? modulePath : "");
    if (modulePath) {
        bfree(modulePath);
    }
    return QDir::fromNativeSeparators(path);
}

QString AiGraphicsBridge::generatedGraphicsDir() const
{
    return QDir::cleanPath(QDir::current().filePath("generated-graphics"));
}

QString AiGraphicsBridge::manifestPath() const
{
    return QDir(generatedGraphicsDir()).filePath("manifest.json");
}

QJsonObject AiGraphicsBridge::loadManifestObject() const
{
    QFile manifestFile(manifestPath());
    if (!manifestFile.exists()) {
        return default_manifest();
    }

    if (!manifestFile.open(QIODevice::ReadOnly)) {
        return default_manifest();
    }

    const auto doc = QJsonDocument::fromJson(manifestFile.readAll());
    if (!doc.isObject()) {
        return default_manifest();
    }

    return doc.object();
}

bool AiGraphicsBridge::saveManifestObject(const QJsonObject &manifest) const
{
    QDir().mkpath(generatedGraphicsDir());
    QFile manifestFile(manifestPath());
    if (!manifestFile.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        return false;
    }
    manifestFile.write(QJsonDocument(manifest).toJson(QJsonDocument::Indented));
    return true;
}

QVariantList AiGraphicsBridge::inspirationAssets() const
{
    QVariantList assets;
    QDir dir(QDir::current().filePath("Inspiration Graphics"));
    const auto files = dir.entryInfoList(QDir::Files | QDir::NoDotAndDotDot);
    for (const auto &file : files) {
        QVariantMap item;
        item.insert("name", file.fileName());
        item.insert("path", QDir::fromNativeSeparators(file.absoluteFilePath()));
        item.insert("url", QUrl::fromLocalFile(file.absoluteFilePath()).toString());
        item.insert("dataUrl", file_to_data_url(file.absoluteFilePath()));
        assets.push_back(item);
    }
    return assets;
}

QVariantMap AiGraphicsBridge::toResponse(bool ok, const QString &message, const QJsonObject &payload) const
{
    QVariantMap response;
    response.insert("ok", ok);
    response.insert("message", message);
    response.insert("payload", payload.toVariantMap());
    return response;
}

QString AiGraphicsBridge::dataUrlToFile(const QString &graphicId, const QString &dataUrl) const
{
    const auto *slot = slot_for(graphicId);
    if (!slot || !dataUrl.contains(',')) {
        return {};
    }

    const auto encoded = dataUrl.section(',', 1);
    const auto bytes = QByteArray::fromBase64(encoded.toLatin1());

    QImage image;
    image.loadFromData(bytes);
    if (image.isNull()) {
        return {};
    }

    QImage canvas(3840, 2160, QImage::Format_ARGB32_Premultiplied);
    canvas.fill(Qt::transparent);

    QPainter painter(&canvas);
    painter.setRenderHint(QPainter::Antialiasing, true);
    painter.setRenderHint(QPainter::SmoothPixmapTransform, true);

    const QSize targetSize(static_cast<int>(slot->width), static_cast<int>(slot->height));
    const auto scaled = image.scaled(targetSize, Qt::KeepAspectRatio, Qt::SmoothTransformation);
    painter.drawImage(QPoint(static_cast<int>(slot->x), static_cast<int>(slot->y)), scaled);
    painter.end();

    const auto fullPath = QDir(generatedGraphicsDir()).filePath(slot->fileName);
    canvas.save(fullPath, "PNG");
    return fullPath;
}
