// 후보 3종. 앱이 이미 :root 토큰(--bg·--surface·--fg·--accent·--radius·--shadow)을 쓰므로 토큰만 덮어 입힌다(앱 코드 무수정).
// 각 DESIGN.md 의 핵심 값을 옮긴 근사치다 — 서체는 사내망에서 웹폰트를 못 받을 수 있어 시스템 스택으로 둔다.
type Tokens = { light: string; dark: string; extra?: string }
export const THEMES: Record<string, Tokens> = {
  baseline: { light: '', dark: '' },
  // A. Linear 계열 — 차분한 중립 + 인디고 한 점, 촘촘, 작은 둥글기, 그림자 없이 선으로 구분.
  linear: {
    light: `--bg:#f7f8f8;--surface:#fff;--surface-soft:#f3f4f5;--fg:#1c1d1f;--muted:#565a62;--line:#e4e5e8;--line-soft:#eeeff1;
      --accent:#5457c4;--accent-soft:#eeeffc;--shadow:none;--radius:.5rem;--radius-sm:.375rem;`,
    dark: `--bg:#0f1011;--surface:#17181a;--surface-soft:#1d1e21;--fg:#eceef0;--muted:#a2a5ad;--line:#26272b;--line-soft:#1d1e21;
      --accent:#8b8ef0;--accent-soft:#1f2036;--on-accent:#0f1011;`,
    extra: `body{letter-spacing:-.005em;line-height:1.5}`,
  },
  // B. Vercel 계열 — 흑백 정밀, 헤어라인, 액센트는 파랑 하나, 둥글기 작게.
  vercel: {
    light: `--bg:#fafafa;--surface:#fff;--surface-soft:#f5f5f5;--fg:#111;--muted:#666;--line:#eaeaea;--line-soft:#f1f1f1;
      --accent:#0062cc;--accent-soft:#eaf3ff;--shadow:none;--radius:.375rem;--radius-sm:.25rem;`,
    dark: `--bg:#000;--surface:#0a0a0a;--surface-soft:#141414;--fg:#ededed;--muted:#a1a1a1;--line:#2e2e2e;--line-soft:#1f1f1f;
      --accent:#52a8ff;--accent-soft:#0f2a47;--on-accent:#000;`,
    extra: `body{line-height:1.55}`,
  },
  // C. Stripe 계열 — 네이비 잉크, 옅은 푸른 회색 바탕, 보라 액센트, 부드러운 그림자, 넉넉한 둥글기.
  stripe: {
    light: `--bg:#f6f9fc;--surface:#fff;--surface-soft:#eef2f8;--fg:#0a2540;--muted:#556b82;--line:#dfe6ee;--line-soft:#eaeff5;
      --accent:#4f46e5;--accent-soft:#eceaff;--shadow:0 1px 2px rgba(10,37,64,.06),0 4px 12px rgba(10,37,64,.06);--radius:.625rem;--radius-sm:.4375rem;`,
    dark: `--bg:#0a1424;--surface:#101c30;--surface-soft:#16243b;--fg:#e6edf6;--muted:#8fa3ba;--line:#1f3049;--line-soft:#16243b;
      --accent:#9b94ff;--accent-soft:#1e1d4a;--on-accent:#0a1424;`,
  },
}
export const css = (t: Tokens, mode: 'light' | 'dark') =>
  `:root{${t.light}}:root[data-theme='dark']{${t.light}${t.dark}}${t.extra ?? ''}`.replace(/\s+/g, ' ')
