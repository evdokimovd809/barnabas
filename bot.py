import asyncio
import logging
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp

TOKEN = "8620711858:AAEzOEzFqCNPaQabdz_oYcIi9ebx5GJTQWE"
APP_URL = "https://evdokimovd809.github.io/barnabas/"
CONSOLE_URL = "https://evdokimovd809.github.io/barnabas/console/"

bot = Bot(token=TOKEN)
dp = Dispatcher()

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Запустить Барнабас", web_app=WebAppInfo(url=APP_URL))]
    ])
    await message.answer(
        "👋 Добро пожаловать в Барнабас!\n\n"
        "Это маркетплейс услуг в стиле inDrive: вы называете цену, мастера откликаются.\n\n"
        "Нажмите кнопку ниже, чтобы начать.",
        reply_markup=kb
    )

@dp.message(Command("console"))
async def cmd_console(message: types.Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Открыть панель оператора", web_app=WebAppInfo(url=CONSOLE_URL))]
    ])
    await message.answer("🛠 Панель оператора Барнабас:", reply_markup=kb)

async def main():
    # Set menu button to open Web App
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=APP_URL))
    )
    logging.basicConfig(level=logging.INFO)
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
