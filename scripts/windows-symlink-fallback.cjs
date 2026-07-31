const fs = require("node:fs");
const path = require("node:path");

const patchMarker = Symbol.for("shredit.windowsSymlinkFallback");

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function createSymlinkWithFallback(
  target,
  destination,
  type,
  {
    mkdir = fs.promises.mkdir.bind(fs.promises),
    platform = process.platform,
    projectRoot = process.cwd(),
    symlink = fs.promises.symlink.bind(fs.promises),
    stat = fs.promises.stat.bind(fs.promises),
  } = {},
) {
  try {
    return await symlink(target, destination, type);
  } catch (error) {
    if (platform !== "win32" || error?.code !== "EPERM" || type != null) {
      throw error;
    }

    const root = path.resolve(projectRoot);
    const standaloneRoot = path.join(root, ".next", "standalone");
    const resolvedDestination = path.resolve(destination);
    const resolvedTarget = path.resolve(
      path.dirname(resolvedDestination),
      target,
    );
    if (
      resolvedDestination === standaloneRoot ||
      !isPathInside(standaloneRoot, resolvedDestination) ||
      !isPathInside(root, resolvedTarget)
    ) {
      throw error;
    }

    const targetStat = await stat(resolvedTarget);
    if (!targetStat.isDirectory()) {
      throw error;
    }

    const mappedTarget = isPathInside(standaloneRoot, resolvedTarget)
      ? resolvedTarget
      : path.join(standaloneRoot, path.relative(root, resolvedTarget));
    if (!isPathInside(standaloneRoot, mappedTarget)) {
      throw error;
    }

    await mkdir(mappedTarget, { recursive: true });
    return symlink(mappedTarget, resolvedDestination, "junction");
  }
}

function installWindowsSymlinkFallback(
  fsModule = fs,
  { platform = process.platform, projectRoot = process.cwd() } = {},
) {
  if (platform !== "win32" || fsModule.promises[patchMarker]) {
    return false;
  }

  const promises = fsModule.promises;
  const originalSymlink = promises.symlink.bind(promises);
  const mkdir = promises.mkdir.bind(promises);
  const stat = promises.stat.bind(promises);

  promises.symlink = (target, destination, type) =>
    createSymlinkWithFallback(target, destination, type, {
      mkdir,
      platform,
      projectRoot,
      stat,
      symlink: originalSymlink,
    });
  Object.defineProperty(promises, patchMarker, { value: true });
  return true;
}

installWindowsSymlinkFallback();

module.exports = {
  createSymlinkWithFallback,
  installWindowsSymlinkFallback,
  isPathInside,
};
