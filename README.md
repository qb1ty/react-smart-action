# ⚡ react-smart-action

> Smart, lightweight, and resilient optimistic UI hooks for React 19. Eliminate boilerplate with automatic rollback, debounce, and retry capabilities.

[![npm version](https://img.shields.io/npm/v/react-smart-action.svg?style=flat-square)](https://www.npmjs.com/package/react-smart-action)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19.0+-61DAFB.svg?style=flat-square)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](https://opensource.org/licenses/MIT)

[🇷🇺 Читать на русском языке (README in Russian)](./README.ru.md)

---

## 💡 Why `react-smart-action`?

React 19 introduced powerful primitives like `useOptimistic` and `useActionState`, but handling real-world scenarios—such as **network failures, automatic state rollbacks, spam-click protection (debounce), and retry logic**—still requires dozens of lines of repetitive boilerplate.

`react-smart-action` wraps these React 19 primitives into a clean, declarative, TypeScript-first suite of hooks designed for production applications.

### ✨ Key Features
- **🛡️ Auto-Rollback on Error:** Seamlessly revert UI state to initial values if network or server requests fail.
- **⚡ Anti-Spam Protection:** Built-in debounce to prevent server flooding from rapid user clicks.
- **🔄 Automatic Retries:** Configure background retries before triggering an error state.
- **📦 Zero Heavy Dependencies:** Built strictly on top of native React 19 APIs.
- **💎 TypeScript-First:** Strict end-to-end type safety for state, inputs, and payloads.

---

## 📦 Installation

```bash
npm install react-smart-action
# or
yarn add react-smart-action
# or
pnpm add react-smart-action