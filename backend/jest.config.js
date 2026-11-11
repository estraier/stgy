/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/*.test.ts"],
  // During tests, resolve shared workspaces from TypeScript source rather than
  // potentially stale dist/ output. Runtime start commands still require builds.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  moduleNameMapper: {
    "^stgy-markdown$": "<rootDir>/../packages/markdown/src/index.ts",
    "^stgy-geocoder$": "<rootDir>/../packages/geocoder/src/index.ts",
    "^stgy-track$": "<rootDir>/../packages/track/src/index.ts",
    "^stgy-track/(activity|analysis|metadata|fit|gpx|trackjson)$":
      "<rootDir>/../packages/track/src/$1.ts",
  },
};

process.env.LOG_LEVEL ??= "silent";
