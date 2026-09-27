# -*- coding: utf-8 -*-
"""theme.py — ares-ppt 设计系统：主题色 3 套、统一字体、字号阶梯、留白与对齐常量。"""
from pptx.dml.color import RGBColor
from pptx.util import Emu, Pt

FONT = "微软雅黑"
SIZES = {"page_title": Pt(32), "h2": Pt(24), "body": Pt(18), "small": Pt(14)}

# 16:9
SLIDE_W = Emu(12192000)
SLIDE_H = Emu(6858000)

MARGIN = Emu(609600)               # 左右留白 ≈1.67cm
TITLE_BAND_H = Emu(1127760)        # 页题带高
FOOTER_H = Emu(304800)
MAX_BODY_CHARS = 120               # 每页正文信息密度上限（PPT文案纪律）

THEMES = {
    "tech_blue": {
        "name": "科技蓝",
        "primary": RGBColor(0x1F, 0x4E, 0x79),
        "accent": RGBColor(0x2E, 0x75, 0xB6),
        "light": RGBColor(0xDE, 0xEB, 0xF7),
        "text": RGBColor(0x26, 0x26, 0x26),
        "muted": RGBColor(0x59, 0x59, 0x59),
        "on_primary": RGBColor(0xFF, 0xFF, 0xFF),
        "bg": RGBColor(0xFF, 0xFF, 0xFF),
    },
    "eco_green": {
        "name": "生态绿",
        "primary": RGBColor(0x1E, 0x5E, 0x3A),
        "accent": RGBColor(0x2E, 0x8B, 0x57),
        "light": RGBColor(0xE3, 0xF2, 0xE7),
        "text": RGBColor(0x26, 0x26, 0x26),
        "muted": RGBColor(0x59, 0x59, 0x59),
        "on_primary": RGBColor(0xFF, 0xFF, 0xFF),
        "bg": RGBColor(0xFF, 0xFF, 0xFF),
    },
    "vitality_orange": {
        "name": "活力橙",
        "primary": RGBColor(0xC2, 0x53, 0x1A),
        "accent": RGBColor(0xE8, 0x7D, 0x2B),
        "light": RGBColor(0xFC, 0xEC, 0xDC),
        "text": RGBColor(0x26, 0x26, 0x26),
        "muted": RGBColor(0x59, 0x59, 0x59),
        "on_primary": RGBColor(0xFF, 0xFF, 0xFF),
        "bg": RGBColor(0xFF, 0xFF, 0xFF),
    },
}

# 行业关键词 → 主题（按项目行业自动选）
INDUSTRY_THEME = {
    "eco_green": ["农业", "环保", "绿色", "能源", "双碳", "生态", "可持续", "碳"],
    "vitality_orange": ["教育", "文创", "电商", "消费", "文旅", "餐饮", "幼", "康养", "体育"],
}


def pick_theme(profile):
    text = ""
    try:
        text = (profile.get("project_name", "") + profile.get("one_liner", "") +
                str(profile.get("solution", {}).get("tech_stack", [])))
    except AttributeError:
        pass
    for theme_key, words in INDUSTRY_THEME.items():
        if any(w in text for w in words):
            return theme_key
    return "tech_blue"
