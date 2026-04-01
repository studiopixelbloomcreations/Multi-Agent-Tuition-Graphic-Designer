#pragma once

#include "ai-graphics-bridge.hpp"

#include <QWidget>

class QWebEngineView;

class AiGraphicsDock : public QWidget {
    Q_OBJECT

public:
    explicit AiGraphicsDock(QWidget *parent = nullptr);

private:
    AiGraphicsBridge *bridge_;
    QWebEngineView *view_;
};
