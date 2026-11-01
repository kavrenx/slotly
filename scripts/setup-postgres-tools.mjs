import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Official EDB binary archive linked from postgresql.org/download/windows/.
// Pinned bytes; nothing is installed globally and no server is started.
const url = "https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip";
const sha256 = "e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2";
try {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Use installed PostgreSQL 18 client tools and PG_BIN_DIR on this platform.");
  const root = resolve(".local/postgres-tools"), bin = resolve(root, "bin"), marker = resolve(root, "version.txt");
  if (await readFile(marker, "utf8").catch(() => "") === sha256) {
    await access(resolve(bin, "pg_dump.exe")); await access(resolve(bin, "pg_restore.exe"));
    console.log("Клиентские утилиты PostgreSQL 18.6 уже подготовлены.");
  } else {
    await mkdir(bin, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink() || (await lstat(bin)).isSymbolicLink()) throw new Error("Tool directories must not be links.");
    const archive = resolve(root, "postgresql-18.6-5.zip");
    if (!await access(archive).then(() => true, () => false)) {
      console.log("Загружаем официальный архив PostgreSQL (около 385 МБ)…");
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error("Download unavailable.");
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: "wx", mode: 0o600 }));
    }
    const hash = createHash("sha256"); for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest("hex") !== sha256) throw new Error("Archive checksum mismatch. Remove the incomplete download before retrying.");
    const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem
      $target=[IO.Path]::GetFullPath($env:SLOTLY_TOOLS_TARGET)
      $archive=[IO.Compression.ZipFile]::OpenRead($env:SLOTLY_TOOLS_ARCHIVE)
      try { foreach($entry in $archive.Entries) {
        if($entry.FullName -match '^pgsql/bin/([A-Za-z0-9_.+-]+\\.dll|pg_dump\\.exe|pg_restore\\.exe)$') {
          $destination=Join-Path $target $entry.Name
          if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($destination)) -ne $target){throw 'Unsafe extraction path'}
          [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$true)
        }
      }} finally {$archive.Dispose()}`;
    await new Promise((accept, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: "ignore", env: { ...process.env, SLOTLY_TOOLS_TARGET: bin, SLOTLY_TOOLS_ARCHIVE: archive } });
      child.once("error", reject); child.once("exit", code => code === 0 ? accept() : reject(new Error("Extraction failed.")));
    });
    await access(resolve(bin, "pg_dump.exe")); await access(resolve(bin, "pg_restore.exe"));
    await writeFile(marker, sha256, { mode: 0o600 }); await unlink(archive);
    console.log("Подготовлены pg_dump и pg_restore в .local/postgres-tools/bin. Архив загрузки удалён.");
  }
} catch {
  console.error("Не удалось подготовить клиентские утилиты. Проверьте сеть, контрольную сумму и docs/operations.md. Глобальные настройки не менялись."); process.exitCode = 1;
}
