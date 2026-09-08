import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPENCV_PACKAGE = "@techstark/opencv-js";
const OPENCV_PACKAGE_VERSION = "5.0.0-release.1";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const destinationDir = join(frontendDir, "public", "vendor", "opencv");

let searchDir = frontendDir;
let packageDir = null;
while (true) {
  const candidate = join(searchDir, "node_modules", "@techstark", "opencv-js");
  try {
    const packageJson = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
    if (packageJson?.name === OPENCV_PACKAGE) {
      if (packageJson.version !== OPENCV_PACKAGE_VERSION) {
        throw new Error(
          `Unexpected ${OPENCV_PACKAGE} version ${packageJson.version}; expected ${OPENCV_PACKAGE_VERSION}`,
        );
      }
      packageDir = candidate;
      break;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unexpected ")) throw error;
  }
  const parent = dirname(searchDir);
  if (parent === searchDir) break;
  searchDir = parent;
}

if (!packageDir) {
  throw new Error(`Could not locate ${OPENCV_PACKAGE}@${OPENCV_PACKAGE_VERSION} under node_modules`);
}

const sourceJs = join(packageDir, "dist", "opencv.js");
await access(sourceJs);
await rm(destinationDir, { recursive: true, force: true });
await mkdir(destinationDir, { recursive: true });
await cp(sourceJs, join(destinationDir, "opencv.js"));

for (const name of ["LICENSE", "LICENSE.md", "README.md"]) {
  const source = join(packageDir, name);
  try {
    await access(source);
    await cp(source, join(destinationDir, name));
  } catch {}
}

await writeFile(
  join(destinationDir, "VERSION"),
  `${OPENCV_PACKAGE}@${OPENCV_PACKAGE_VERSION}\nOpenCV 5.0.0\n`,
  "utf8",
);
