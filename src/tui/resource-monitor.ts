import fs from "fs";
import os from "os";
import path from "path";

export class ResourceMonitor {
  private logPath: string;
  private timer: NodeJS.Timeout | null = null;
  private lastCpuUsage: NodeJS.CpuUsage;
  private lastTime: number;

  constructor() {
    const logDir = path.join(os.homedir(), ".openclaw", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    this.logPath = path.join(
      logDir,
      `tui-resources-${new Date().toISOString().replace(/:/g, "-")}.log`,
    );
    this.lastCpuUsage = process.cpuUsage();
    this.lastTime = Date.now();
  }

  public start(intervalMs = 5000) {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.logStats(), intervalMs);
    this.timer.unref(); // Don't block exit
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async logStats() {
    try {
      const memUsage = process.memoryUsage();
      const currentCpuUsage = process.cpuUsage();
      const currentTime = Date.now();

      const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
      const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
      const timeDiff = (currentTime - this.lastTime) * 1000; // micro-seconds

      const cpuPercent = ((userDiff + systemDiff) / timeDiff) * 100;

      this.lastCpuUsage = currentCpuUsage;
      this.lastTime = currentTime;

      const rssMb = (memUsage.rss / 1024 / 1024).toFixed(2);
      const heapTotalMb = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
      const heapUsedMb = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
      const extMb = (memUsage.external / 1024 / 1024).toFixed(2);

      const sysLoad = os
        .loadavg()
        .map((x) => x.toFixed(2))
        .join(", ");

      const logLine = `[${new Date().toISOString()}] CPU: ${cpuPercent.toFixed(2)}% | RSS: ${rssMb} MB | Heap (used/total): ${heapUsedMb}/${heapTotalMb} MB | Ext: ${extMb} MB | SysLoad: ${sysLoad}\n`;

      fs.appendFile(this.logPath, logLine, () => {});
    } catch {
      // ignore
    }
  }
}
