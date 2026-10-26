# Тесты Барнабаса

Всё работает локально, на эмуляторах Firebase. Боевая база не затрагивается.

Нужно один раз: Node.js 18+, Java 21 (для эмулятора Firestore), Google Chrome, затем в папке проекта:

```
npm install
```

Запуск (в трёх окнах терминала):

```
npm run emulators      # Firestore + Auth на 127.0.0.1:8080 и :9099
npm run serve          # отдаёт index.html на http://127.0.0.1:8766
npm run test:rules     # 109 проверок правил firestore.rules
npm run test:e2e       # сквозной сценарий: заказчик, 2 мастера, оператор (97 проверок, снимки в tests/shots)
npm run test:migrate   # перенос данных из v2
```

Открыть приложение вручную на эмуляторах: http://127.0.0.1:8766/index.html?emu=1
(параметр `emu` работает только на 127.0.0.1/localhost; пароль оператора в эмуляторе — `secret`).

Опубликовать правила в боевой Firebase из терминала (вместо копирования в консоль): `npx firebase login`, затем `npm run deploy:rules`.
