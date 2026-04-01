#include "ai-graphics-dock.hpp"

#include <obs-module.h>

#include <QDir>
#include <QVBoxLayout>
#include <QWebChannel>
#include <QWebEngineSettings>
#include <QWebEngineView>

AiGraphicsDock::AiGraphicsDock(QWidget *parent)
    : QWidget(parent),
      bridge_(new AiGraphicsBridge(this)),
      view_(new QWebEngineView(this))
{
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->addWidget(view_);

    auto *channel = new QWebChannel(view_->page());
    channel->registerObject(QStringLiteral("obsBridge"), bridge_);
    view_->page()->setWebChannel(channel);
    view_->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, true);
    view_->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, true);

    char *indexFile = obs_module_file("ui/index.html");
    const auto url = QUrl::fromLocalFile(QDir::fromNativeSeparators(QString::fromUtf8(indexFile ? indexFile : "")));
    if (indexFile) {
        bfree(indexFile);
    }

    view_->load(url);
}
