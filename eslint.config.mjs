import js from "@eslint/js";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".data/**",
      "artifacts/**",
      "backups/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,vue}", "public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/server/**", "**/scripts/**"] }],
    },
  },
  {
    files: ["server/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: ["**/src/**"] }] },
  },
  {
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["**/src/**", "**/server/**", "**/scripts/**"] },
      ],
    },
  },
  {
    files: ["server/**/*.ts", "scripts/**/*.{ts,mjs}", "tests/**/*.ts", "*.{ts,mjs}"],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
