import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Project guard-rails (FE-S2-08). Each rule encodes a prototype bug class we fixed, so it can't creep back:
 *  - UI talks to data only through the typed API client (no direct mock/DB or server-auth imports)  → architecture (API swap in R1)
 *  - no native confirm/alert/prompt (blocking, unstyled, not translatable)                           → B-09
 *  - locale-aware navigation only (next/link & next/navigation hooks drop the /en|/bn prefix)          → B-05
 *  - design-system primitives come from @/components/ui (base-ui), never Radix directly
 *  - no hex colours — colours come from tokens in globals.css (dark mode + accents depend on it)        → B-04
 *  - no hard-coded English in JSX text or in placeholder/title/aria-label/alt (EN/BN parity)            → B-05
 *    Acronyms (VAT, BIN, CSV, HS) pass. Brand names/endonyms need an eslint-disable with a reason.
 */
const noHex = [
  { selector: "Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?\\b/]", message: "No hex colours — use a design token (globals.css) such as bg-primary, text-muted-foreground or bg-swatch-*." },
  { selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?\\b/]", message: "No hex colours — use a design token (globals.css)." },
];
const noLiteralText = [
  { selector: "JSXText[value=/[a-z]{3,}/]", message: "User-visible text must come from the message catalogs (t(\"…\")) so Bengali stays complete." },
  { selector: "JSXAttribute[name.name=/^(placeholder|title|aria-label|alt)$/] > Literal[value=/[a-z]{3,}/]", message: "Translate placeholder/title/aria-label/alt via t(\"…\")." },
];
const uiImports = {
  patterns: [
    { group: ["@/lib/mock/*", "**/lib/mock/*"], message: "UI must fetch data through @/lib/api/client (typed API layer), not the mock DB." },
    { group: ["@/lib/auth/server", "@/lib/auth/session"], message: "Server-only auth module. In the UI use useMe()/useCan() from @/components/auth/me-provider." },
    { group: ["@radix-ui/*"], message: "Use the shadcn/base-ui primitives in @/components/ui." },
  ],
  paths: [
    { name: "next/link", message: "Use Link from @/i18n/navigation (keeps the locale prefix)." },
    { name: "next/navigation", importNames: ["useRouter", "usePathname", "redirect"], message: "Use the locale-aware versions from @/i18n/navigation." },
  ],
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", uiImports],
      "no-restricted-syntax": ["error", ...noHex, ...noLiteralText],
      "no-restricted-globals": ["error",
        { name: "confirm", message: "Use useConfirm() from @/components/common/confirm." },
        { name: "alert", message: "Use toast from sonner." },
        { name: "prompt", message: "Use a Dialog with a form field." },
      ],
      "no-restricted-properties": ["error",
        { object: "window", property: "confirm", message: "Use useConfirm() from @/components/common/confirm." },
        { object: "window", property: "alert", message: "Use toast from sonner." },
        { object: "window", property: "prompt", message: "Use a Dialog with a form field." },
      ],
    },
  },
  {
    // Mushak 6.3 / 6.8 reproduce the NBR-prescribed bilingual forms; its captions are fixed by law, not UI copy
    files: ["src/features/sales/mushak-63.tsx", "src/features/r2/mushak-68.tsx", "src/features/credit/mushak-67.tsx", "src/features/production/mushak-43.tsx", "src/features/production/mushak-64.tsx", "src/features/vat/tr6-print.tsx", "src/features/vat/mushak-66.tsx", "src/features/vat/mushak-610.tsx"],
    rules: { "no-restricted-syntax": ["error", ...noHex] },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
