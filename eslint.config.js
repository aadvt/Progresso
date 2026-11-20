import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "data/**", "packages/db/drizzle/**"] },
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
          message: "Do not hard-code concept ids in source. Load them from the concept graph."
        }
      ]
    }
  },
  {
    // Tests may reference concept ids from the test graphs and fixtures.
    files: ["**/test/**", "**/*.test.ts"],
    rules: { "no-restricted-syntax": "off" }
  }
);
