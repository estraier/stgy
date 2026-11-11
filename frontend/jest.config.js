/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.jest.json",
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Test directly against shared TypeScript source, not stale dist builds.
    "^stgy-markdown$": "<rootDir>/../packages/markdown/src/index.ts",
    "^stgy-geocoder$": "<rootDir>/../packages/geocoder/src/index.ts",
    "^stgy-track$": "<rootDir>/../packages/track/src/index.ts",
    "^stgy-track/(activity|analysis|metadata|fit|gpx|trackjson)$":
      "<rootDir>/../packages/track/src/$1.ts",
  },
};
