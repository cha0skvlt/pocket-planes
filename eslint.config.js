// ESLint flat config. Strict-but-sane for the game code style (terse, no semicolons,
// heavy one-liners in PPE-graphics). Tests may use node APIs.
import js from '@eslint/js';

export default [
  { ignores: ['node_modules/', 'dist/', 'PPE-server/dist/', 'PPE-physics/target/', 'old/', 'PPE-graphics/sim/pocket_physics.wasm'] },
  {
    files: ['PPE-graphics/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // browser
        window: 'readonly', document: 'readonly', performance: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        addEventListener: 'readonly', removeEventListener: 'readonly',
        dispatchEvent: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly',
        PointerEvent: 'readonly', HTMLCanvasElement: 'readonly', location: 'readonly',
        navigator: 'readonly', AudioContext: 'readonly', fetch: 'readonly',
        WebAssembly: 'readonly', console: 'readonly', screen: 'readonly',
        AbortController: 'readonly', CustomEvent: 'readonly',
        setInterval: 'readonly', setTimeout: 'readonly',
        devicePixelRatio: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
        URLSearchParams: 'readonly',
        // node (tests)
        process: 'readonly', URL: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-fallthrough': 'error',
      'no-loss-of-precision': 'error',
      'no-unsafe-negation': 'error',
      'no-use-before-define': ['error', { functions: false, classes: false }],
      'require-atomic-updates': 'off',
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      eqeqeq: ['error', 'smart'],
      'no-else-return': 'off', // style freedom: the codebase leans on early-return-free one-liners
    },
  },
];
