import globals from "globals";

const eslintConfig = [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-page-custom-font": "off",
    },
  },
];

export default eslintConfig;
