const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["src/**/*.{ts,js}"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // 'any' is unavoidable in some Express/AWS SDK patterns — warn only.
      "@typescript-eslint/no-explicit-any": "warn",
      // Intentionally-unused params must be prefixed with _ (e.g. Express error handlers).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
