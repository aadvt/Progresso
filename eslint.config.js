import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "**/test-results/**",
      "**/playwright-report/**",
      "data/**",
      "packages/db/drizzle/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // Domain code must never hard-code concept ids; graph data is loaded from files.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^(math|chem)[.][a-z0-9_]+/]",
          message: "Do not hard-code concept ids in source. Load them from the concept graph.",
        },
      ],
    },
  },
  {
    // Web app: React hook rules and accessibility lint.
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // role="list" is deliberate: Safari/VoiceOver drops list semantics when list-style is none.
      "jsx-a11y/no-redundant-roles": ["error", { ul: ["list"], ol: ["list"] }],
    },
  },
  {
    // Tests may reference concept ids from the test graphs and fixtures.
    files: ["**/test/**", "**/*.test.ts", "**/e2e/**"],
    rules: { "no-restricted-syntax": "off" },
  },
);
