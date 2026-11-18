/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['coverage/**', 'dist/**', 'demo/dist/**'],
  rules: {
    'import-notation': 'string',
    'value-keyword-case': ['lower', { camelCaseSvgKeywords: true }]
  }
};
