# ⚡ react-smart-action

> Умные, легкие и отказоустойчивые хуки оптимистичного UI для React 19. Избавьтесь от бойлерплейта благодаря автоматическому откату состояния, защите от спам-кликов и повторным попыткам запросов.

[![npm version](https://img.shields.io/npm/v/react-smart-action.svg?style=flat-square)](https://www.npmjs.com/package/react-smart-action)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19.0+-61DAFB.svg?style=flat-square)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](https://opensource.org/licenses/MIT)

[🇺🇸 Read in English (README на английском)](./README.md)

---

## 💡 Почему именно `react-smart-action`?

В React 19 появились отличные нативные примитивы, такие как `useOptimistic` и `useActionState`. Однако в реальных проектах разработчикам всё ещё приходится писать десятки строк рутинного кода для обработки **сбоев сети, автоматического отката (Rollback) UI, защиты от частых кликов (Debounce) и повторных попыток запросов (Retry)**.

`react-smart-action` оборачивает нативные возможности React 19 в чистый, декларативный и типизированный набор хуков, созданный специально для production-приложений.

### ✨ Главные преимущества
- **🛡️ Автоматический откат при ошибке:** Если сервер вернет ошибку или пропадет интернет, интерфейс мгновенно и без багов вернется к исходному состоянию.
- **⚡ Защита от спам-кликов (Debounce):** Встроенная задержка отправки запросов, если пользователь неистово кликает по кнопке.
- **🔄 Авто-повторы (Retry):** Настройка фоновых повторных попыток отправки запроса перед тем, как показать ошибку.
- **📦 Ноль тяжелых зависимостей:** Библиотека построена строго поверх нативных API React 19.
- **💎 100% TypeScript:** Полная строгая типизация входящих параметров, состояния и ответов сервера.

---

## 📦 Установка

```bash
npm install react-smart-action
# или
yarn add react-smart-action
# или
pnpm add react-smart-action