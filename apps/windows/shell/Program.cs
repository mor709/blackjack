using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    private const string CacheVersion = "v10";
    private const string CacheFolder = "春山21点-运行数据";
    private static bool receivedHeartbeat;
    private static DateTime lastHeartbeat;

    [STAThread]
    private static void Main()
    {
        string root;
        try
        {
            root = EnsureSite();
        }
        catch (Exception exception)
        {
            WriteStartupLog(exception);
            MessageBox.Show("无法准备游戏文件，请重新下载完整的春山21点.exe。", "春山 21点");
            return;
        }

        var browser = FindBrowser();
        if (browser == null)
        {
            MessageBox.Show("未找到可用浏览器。请安装 Microsoft Edge 或 Chrome 后重新打开。", "春山 21点");
            return;
        }

        var address = GetAvailableAddress();
        var browserProfile = Path.Combine(GetCacheRoot(), "browser-profile");
        Directory.CreateDirectory(browserProfile);
        var listener = new HttpListener();
        listener.Prefixes.Add(address);
        try
        {
            listener.Start();
        }
        catch (Exception)
        {
            MessageBox.Show("无法启动本地游戏服务，请关闭其他春山21点窗口后重试。", "春山 21点");
            return;
        }
        Task.Run(() => Serve(listener, root));

        try
        {
            var arguments = browser.Arguments + '"' + address + '"';
            if (browser.UseDedicatedProfile)
            {
                var workingArea = Screen.PrimaryScreen.WorkingArea;
                var width = Math.Min(1280, Math.Max(760, workingArea.Width - 80));
                var height = Math.Min(900, Math.Max(620, workingArea.Height - 80));
                var left = workingArea.Left + (workingArea.Width - width) / 2;
                var top = workingArea.Top + (workingArea.Height - height) / 2;

                arguments += " --window-size=" + width + "," + height;
                arguments += " --window-position=" + left + "," + top;
                arguments += " --user-data-dir=\"" + browserProfile + "\"";
            }
            Process.Start(new ProcessStartInfo(browser.Executable, arguments)
            {
                UseShellExecute = true,
            });

            var startupDeadline = DateTime.UtcNow.AddMinutes(2);
            while (listener.IsListening)
            {
                if (!receivedHeartbeat && DateTime.UtcNow >= startupDeadline) break;
                if (receivedHeartbeat && DateTime.UtcNow - lastHeartbeat > TimeSpan.FromSeconds(45)) break;
                Thread.Sleep(500);
            }
        }
        finally
        {
            listener.Stop();
            listener.Close();
        }
    }

    private static string GetAvailableAddress()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return "http://127.0.0.1:" + port + "/";
    }

    private static string EnsureSite()
    {
        var appRoot = GetCacheRoot();
        var site = Path.Combine(appRoot, "site");
        if (File.Exists(Path.Combine(site, "index.html"))) return site;

        Directory.CreateDirectory(appRoot);
        using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("site.zip"))
        {
            if (source == null) throw new InvalidOperationException("缺少内置游戏文件。");
            using (var archive = new ZipArchive(source, ZipArchiveMode.Read))
            {
                archive.ExtractToDirectory(appRoot);
            }
        }

        if (!File.Exists(Path.Combine(site, "index.html")))
        {
            throw new InvalidOperationException("游戏文件不完整。");
        }
        return site;
    }

    private static string GetCacheRoot()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            CacheFolder,
            CacheVersion);
    }

    private static void WriteStartupLog(Exception exception)
    {
        try
        {
            File.WriteAllText(
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "春山21点-启动错误.txt"),
                exception.ToString());
        }
        catch
        {
            // Failure reporting must never prevent the user-facing dialog.
        }
    }

    private static BrowserLaunch FindBrowser()
    {
        var chromiumCandidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
        };
        foreach (var candidate in chromiumCandidates)
        {
            if (File.Exists(candidate))
            {
                return new BrowserLaunch { Executable = candidate, Arguments = "--app=", UseDedicatedProfile = true };
            }
        }

        var firefoxCandidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Mozilla Firefox", "firefox.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Mozilla Firefox", "firefox.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mozilla Firefox", "firefox.exe"),
        };
        foreach (var candidate in firefoxCandidates)
        {
            if (File.Exists(candidate))
            {
                return new BrowserLaunch { Executable = candidate, Arguments = "-new-window " };
            }
        }
        var registeredFirefox = FindRegisteredExecutable("firefox.exe");
        if (registeredFirefox != null)
        {
            return new BrowserLaunch { Executable = registeredFirefox, Arguments = "-new-window " };
        }
        return null;
    }

    private static string FindRegisteredExecutable(string name)
    {
        var keys = new[]
        {
            @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name,
            @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\" + name,
            @"HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name,
        };
        foreach (var key in keys)
        {
            var value = Registry.GetValue(key, "", null) as string;
            if (!String.IsNullOrEmpty(value) && File.Exists(value)) return value;
        }
        return null;
    }

    private sealed class BrowserLaunch
    {
        internal string Executable;
        internal string Arguments;
        internal bool UseDedicatedProfile;
    }

    private static async Task Serve(HttpListener listener, string root)
    {
        while (listener.IsListening)
        {
            try
            {
                var context = await listener.GetContextAsync();
                Handle(context, root);
            }
            catch (HttpListenerException)
            {
                return;
            }
            catch
            {
                // A malformed local request must not stop the game window.
            }
        }
    }

    private static void Handle(HttpListenerContext context, string root)
    {
        var requested = Uri.UnescapeDataString(context.Request.Url.AbsolutePath).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        if (String.Equals(requested, "__heartbeat", StringComparison.OrdinalIgnoreCase))
        {
            receivedHeartbeat = true;
            lastHeartbeat = DateTime.UtcNow;
            context.Response.StatusCode = 204;
            context.Response.Close();
            return;
        }
        var file = Path.GetFullPath(Path.Combine(root, String.IsNullOrEmpty(requested) ? "index.html" : requested));
        var safeRoot = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        if (!file.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
        {
            context.Response.StatusCode = 404;
            context.Response.Close();
            return;
        }

        var extension = Path.GetExtension(file).ToLowerInvariant();
        var types = new Dictionary<string, string>
        {
            { ".css", "text/css; charset=utf-8" }, { ".html", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" }, { ".json", "application/json; charset=utf-8" },
            { ".ogg", "audio/ogg" }, { ".svg", "image/svg+xml" }, { ".webp", "image/webp" },
            { ".woff2", "font/woff2" },
        };
        context.Response.ContentType = types.ContainsKey(extension) ? types[extension] : "application/octet-stream";
        var bytes = File.ReadAllBytes(file);
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
        context.Response.Close();
    }

}
