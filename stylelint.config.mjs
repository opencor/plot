/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['coverage/**', 'dist/**'],
  rules: {
    'import-notation': 'string',
    'value-keyword-case': ['lower', { camelCaseSvgKeywords: true }]
  }
};
