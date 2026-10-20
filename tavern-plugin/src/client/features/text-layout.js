// 外观 → 正文排版：字号（就是 DSH 通用设置里的「字号大小」，两边联动）、行间距、字间距。
// 只作用于酒馆正文、玩家对话气泡与舞台文本；卡片自己的 HTML 界面保持卡的排版。
// 行距与字距是看屏幕的偏好，存在本机。思路来自 DrifterJD/ZITI。
const TAVERN_TEXT_LAYOUT_KEY = "dsh-tavern-text-layout";
const TAVERN_TEXT_LAYOUT_LIMITS = Object.freeze({ lineHeight: [1, 3], letterSpacing: [-0.1, 0.3] });

function normalizeTavernTextLayout(value) {
    const source = value && typeof value === "object" ? value : {};
    const clamp = function (raw, range) {
        const number = Number(raw);
        if (raw === null || raw === "" || !Number.isFinite(number)) return null;
        return Math.round(Math.min(range[1], Math.max(range[0], number)) * 1000) / 1000;
    };
    return { lineHeight: clamp(source.lineHeight, TAVERN_TEXT_LAYOUT_LIMITS.lineHeight), letterSpacing: clamp(source.letterSpacing, TAVERN_TEXT_LAYOUT_LIMITS.letterSpacing) };
}

function readTavernTextLayout() {
    try { return normalizeTavernTextLayout(JSON.parse(window.localStorage.getItem(TAVERN_TEXT_LAYOUT_KEY) || "null")); }
    catch (_) { return normalizeTavernTextLayout(null); }
}

// 没调过的项不写变量：行高沿用酒馆原来的 24px + 字号增量，字距保持默认。
function applyTavernTextLayout(layout, root) {
    const element = root || document.documentElement;
    const custom = layout.lineHeight !== null || layout.letterSpacing !== null;
    element.toggleAttribute("data-dsh-text-layout", custom);
    if (layout.lineHeight === null) element.style.removeProperty("--dsh-tavern-line-height");
    else element.style.setProperty("--dsh-tavern-line-height", String(layout.lineHeight));
    if (layout.letterSpacing === null) element.style.removeProperty("--dsh-tavern-letter-spacing");
    else element.style.setProperty("--dsh-tavern-letter-spacing", layout.letterSpacing + "em");
}

// 酒馆原来的行高是 24px + (字号 − 14px)，换算成倍数作为「默认」的显示值。
function defaultTavernLineHeight(fontSize) {
    return Math.round((24 + fontSize - 14) / fontSize * 100) / 100;
}

// DSH 0.2.0 的正文只有一个字号（`fontSize` / `setFontSize(px)`），0.2.1 才按角色
// 拆开（`fontSizes.text` / `setFontSize("text", px)`）。Android 内置的是 0.2.0，
// 用新签名会把 "text" 当字号传进去，报 “font size text is outside 10..22”。
function tavernThemeTextFontSize(snapshot) {
    const sizes = snapshot && snapshot.fontSizes;
    if (sizes && Number.isFinite(sizes.text)) return sizes.text;
    const fontSize = snapshot && snapshot.fontSize;
    return Number.isFinite(fontSize) ? fontSize : 14;
}

function setTavernThemeTextFontSize(theme, px) {
    const snapshot = theme.getTheme();
    if (snapshot && snapshot.fontSizes) return theme.setFontSize("text", px);
    return theme.setFontSize(px);
}

// 字号上限由宿主决定：0.2.0 和没打上补丁的 0.2.1 是 22，Tavern 打过补丁的宿主是 32。
// 先按 32 给，宿主拒绝时收窄到它报出的上限并重试——手机滑到 23 以上也不会整段失灵。
const TAVERN_THEME_FONT_MIN = 10;
const TAVERN_THEME_FONT_MAX = 32;
function tavernHostFontRange(message) {
    const match = /outside\s+(\d+)\s*\.\.\s*(\d+)/.exec(String(message || ""));
    return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}

function createTavernTextLayoutFeature() {
    let layout = readTavernTextLayout();
    const listeners = new Set();
    function update(patch) {
        layout = normalizeTavernTextLayout(Object.assign({}, layout, patch));
        try { window.localStorage.setItem(TAVERN_TEXT_LAYOUT_KEY, JSON.stringify(layout)); } catch (_) {}
        applyTavernTextLayout(layout);
        listeners.forEach(function (listener) { listener(layout); });
    }

    function TextLayoutRow(props) {
        const h = React.createElement;
        const theme = props.theme;
        const [current, setCurrent] = React.useState(layout);
        const [fontSize, setFontSize] = React.useState(function () { return tavernThemeTextFontSize(theme.getTheme()); });
        const [maxFontSize, setMaxFontSize] = React.useState(TAVERN_THEME_FONT_MAX);
        const maxFontSizeRef = React.useRef(TAVERN_THEME_FONT_MAX);
        const [error, setError] = React.useState("");
        React.useEffect(function () {
            listeners.add(setCurrent);
            return function () { listeners.delete(setCurrent); };
        }, []);
        React.useEffect(function () {
            // 通用设置里改了字号，这里跟着变。
            return props.onThemeChange(function (snapshot) { setFontSize(tavernThemeTextFontSize(snapshot)); });
        }, []);
        function changeFontSize(px) {
            setError("");
            const value = Math.min(maxFontSizeRef.current, Math.max(TAVERN_THEME_FONT_MIN, Math.round(px)));
            try { setTavernThemeTextFontSize(theme, value); }
            catch (err) {
                const message = String(err && err.message || err);
                const range = tavernHostFontRange(message);
                // 这个宿主的上限更低：把滑杆收窄到上限，改设上限值，不把宿主报错摆在设置页上。
                if (range && range.max < value) {
                    maxFontSizeRef.current = range.max;
                    setMaxFontSize(range.max);
                    try { setTavernThemeTextFontSize(theme, range.max); } catch (_) {}
                    return;
                }
                setError(message);
            }
        }
        const shownFontSize = Math.max(TAVERN_THEME_FONT_MIN, Math.min(maxFontSize, fontSize));
        const lineHeight = current.lineHeight === null ? defaultTavernLineHeight(shownFontSize) : current.lineHeight;
        const letterSpacing = current.letterSpacing === null ? 0 : current.letterSpacing;
        function field(label, hint, value, min, max, step, unit, onChange) {
            return h("label", { className: "dsh-tavern-text-layout-field" },
                h("span", { className: "dsh-tavern-text-layout-label" }, label, h("small", null, hint)),
                h("input", { type: "range", min: min, max: max, step: step, value: value, "aria-label": label, onChange: function (event) { onChange(Number(event.target.value)); } }),
                h("span", { className: "dsh-tavern-text-layout-value" }, value + unit));
        }
        return h("section", { className: "dsh-tavern-text-layout" },
            h("div", { className: "dsh-tavern-text-layout-head" },
                h("strong", null, "正文排版"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: current.lineHeight === null && current.letterSpacing === null && shownFontSize === 14,
                    onClick: function () { update({ lineHeight: null, letterSpacing: null }); if (shownFontSize !== 14) changeFontSize(14); } }, "恢复默认")),
            h("p", { className: "dsh-tavern-settings-desc" }, "作用于酒馆正文、你的对话气泡和舞台文本，卡片自带的界面不受影响。字号与「通用设置」里的字号大小是同一个设置。"),
            field("字号", "px", shownFontSize, TAVERN_THEME_FONT_MIN, maxFontSize, 1, "px", changeFontSize),
            field("行间距", "倍", lineHeight, 1, 3, 0.05, "×", function (value) { update({ lineHeight: value }); }),
            field("字间距", "em", letterSpacing, -0.1, 0.3, 0.01, "em", function (value) { update({ letterSpacing: value }); }),
            h("p", { className: "dsh-tavern-text-layout-preview", style: { fontSize: shownFontSize + "px", lineHeight: lineHeight, letterSpacing: letterSpacing + "em" } },
                "夜色从窗棂上滑下来，落在她的发梢。她抬起头，轻声说：「雨停了，我们走吧。」"),
            error ? h("p", { className: "dsh-tavern-settings-error", role: "alert" }, error) : null);
    }

    function register(ctx) {
        applyTavernTextLayout(layout);
        // 外观页由内置的 dsh-dream-skin 提供；没有它时这一行不出现，已保存的排版照样生效。
        return ctx.slots.inject("settings.dreamSkin.item", function () {
            return ctx.slots.register({
                name: "settings.dreamSkin.item",
                id: "dsh-tavern-text-layout",
                order: 15,
                inject: function () {
                    return { theme: ctx.theme, onThemeChange: function (listener) { return ctx.on("theme/change", listener); } };
                }
            }, TextLayoutRow);
        });
    }

    return Object.freeze({ register: register, update: update, normalize: normalizeTavernTextLayout, defaultLineHeight: defaultTavernLineHeight, apply: applyTavernTextLayout });
}

const tavernTextLayoutFeature = createTavernTextLayoutFeature();
