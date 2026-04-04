<script lang="ts">
    import { onMount } from "svelte";
    import { apiFetch, needsAuthModal } from "$lib/api";

        interface Instance {
        name: string;
        port: number;
        status: string;
        healthy?: boolean;
        size?: string;
        sizeLimit?: string;
        overQuota?: boolean;
        created?: string;
        version?: string;
    }

    interface Credentials {
        name: string;
        email: string;
        password: string;
    }

    let instances: Instance[] = [];
    let loading = true;
    let error: string | null = null;
    let showAddModal = false;
    let showCredsModal = false;
    let lastCreatedCreds: Credentials | null = null;
    let newInstanceName = "";
    let creating = false;
    let systemStats = {
        load: null as string | null,
        memoryPercent: null as number | null,
        diskUsage: "0B",
    };

    // Advanced options
    let showAdvanced = false;
    let customPort = "";
    let customEmail = "";
    let customPassword = "";
    let customSizeLimit = "";
    let portError = "";
    let portChecking = false;
    let selectedVersion = "";
    let availableVersions: string[] = [];
    let installedVersions: string[] = [];
    let latestVersion = "";
    let loadingVersions = false;

    async function fetchInstances() {
        try {
            const res = await apiFetch("/instances");
            if (!res.ok) throw new Error("Failed to fetch instances");
            const data = await res.json();
            instances = data.instances || [];
            error = null;
        } catch (e) {
            error = e instanceof Error ? e.message : "Unknown error";
        } finally {
            loading = false;
        }
    }

    async function fetchStats() {
        try {
            const res = await apiFetch("/stats");
            if (res.ok) {
                systemStats = await res.json();
            }
        } catch (e) {
            // Stats not critical
        }
    }

    async function fetchVersions() {
        loadingVersions = true;
        try {
            // Get latest version
            const latestRes = await apiFetch("/versions/latest");
            if (latestRes.ok) {
                const data = await latestRes.json();
                latestVersion = data.version || "";
                if (!selectedVersion) {
                    selectedVersion = latestVersion;
                }
            }

            // Get installed versions
            const installedRes = await apiFetch("/versions/installed");
            if (installedRes.ok) {
                const data = await installedRes.json();
                installedVersions = data.versions || [];
            }

            // Get available versions (limited list)
            const availableRes = await apiFetch("/versions/available");
            if (availableRes.ok) {
                const data = await availableRes.json();
                availableVersions = data.versions || [];
            }
        } catch (e) {
            console.error("Failed to fetch versions:", e);
        } finally {
            loadingVersions = false;
        }
    }

    async function checkPort(port: string) {
        if (!port) {
            portError = "";
            return true;
        }
        const num = parseInt(port, 10);
        if (isNaN(num)) {
            portError = "Must be a number";
            return false;
        }
        if (num < 30000 || num > 39999) {
            portError = "Must be 30000-39999";
            return false;
        }

        portChecking = true;
        try {
            const res = await apiFetch(`/ports/check/${num}`);
            const data = await res.json();
            if (!data.available) {
                portError = data.inUse
                    ? "Port already in use"
                    : "Port out of range";
                return false;
            }
            portError = "";
            return true;
        } catch {
            portError = "Could not verify port";
            return false;
        } finally {
            portChecking = false;
        }
    }

    async function addInstance() {
        if (!newInstanceName.trim()) return;
        if (portError) return;

        creating = true;
        try {
            const body = {
                name: newInstanceName.trim(),
                port: customPort ? parseInt(customPort, 10) : undefined,
                email: customEmail ? customEmail.trim() : undefined,
                password: customPassword || undefined,
                version: selectedVersion || undefined,
                sizeLimit: customSizeLimit.trim() || undefined,
            };

            const res = await apiFetch("/instances", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const result = await res.json();
            if (!res.ok)
                throw new Error(result.error || "Failed to create instance");

            lastCreatedCreds = {
                name: newInstanceName.trim(),
                ...result.credentials,
            };
            showAddModal = false;
            showCredsModal = true;
            // Reset form
            newInstanceName = "";
            customPort = "";
            customEmail = "";
            customPassword = "";
            customSizeLimit = "";
            showAdvanced = false;
            portError = "";
            await fetchInstances();
        } catch (e) {
            error = e instanceof Error ? e.message : "Unknown error";
        } finally {
            creating = false;
        }
    }

    async function removeInstance(name: string) {
        if (!confirm(`Delete instance "${name}" and ALL data?`)) return;
        try {
            const res = await apiFetch(`/instances/${name}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to delete instance");
            await fetchInstances();
        } catch (e) {
            error = e instanceof Error ? e.message : "Unknown error";
        }
    }

    async function toggleInstance(name: string, action: string) {
        try {
            const res = await apiFetch(`/instances/${name}/${action}`, {
                method: "POST",
            });
            if (!res.ok) throw new Error(`Failed to ${action} instance`);
            await fetchInstances();
        } catch (e) {
            error = e instanceof Error ? e.message : "Unknown error";
        }
    }

    onMount(() => {
        fetchInstances();
        fetchStats();
        fetchVersions();
        const interval = setInterval(() => {
            fetchInstances();
            fetchStats();
        }, 5000);
        return () => clearInterval(interval);
    });

    $: stats = {
        total: instances.length,
        running: instances.filter((i) => i.status === "running").length,
        stopped: instances.filter((i) => i.status !== "running").length,
    };
</script>

<div class="flex min-h-screen bg-[#0a0a0a] text-gray-100 font-sans">
    <!-- Sidebar -->
    <aside class="w-64 bg-[#111] border-r border-gray-800/50 flex flex-col p-5">
        <div class="flex items-center gap-3 mb-10 px-2">
            <div
                class="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center"
            >
                <svg
                    class="w-5 h-5 text-black"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    ><path
                        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                    /></svg
                >
            </div>
            <span class="text-lg font-bold tracking-tight">Multi-PB</span>
        </div>

        <nav class="flex-1 space-y-1">
            <a
                href="."
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 font-medium text-sm transition-all border border-emerald-500/20"
            >
                <svg
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><rect x="3" y="3" width="7" height="7" /><rect
                        x="14"
                        y="3"
                        width="7"
                        height="7"
                    /><rect x="14" y="14" width="7" height="7" /><rect
                        x="3"
                        y="14"
                        width="7"
                        height="7"
                    /></svg
                >
                Dashboard
            </a>
            <a
                href="settings"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-500 hover:bg-gray-800/50 hover:text-gray-300 font-medium text-sm transition-all"
            >
                <svg
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><circle cx="12" cy="12" r="3" /><path
                        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
                    /></svg
                >
                Settings
            </a>
            <a
                href="https://pocketbase.io/docs"
                target="_blank"
                rel="noopener"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-500 hover:bg-gray-800/50 hover:text-gray-300 font-medium text-sm transition-all"
            >
                <svg
                    class="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    ><path
                        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                    /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg
                >
                PocketBase Docs
            </a>
        </nav>

        <div class="mt-auto pt-4 border-t border-gray-800/50 space-y-1">
            <div class="flex items-center gap-3 px-2">
                <div
                    class="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-emerald-400"
                >
                    A
                </div>
                <div>
                    <p class="text-sm font-medium text-gray-300">Admin</p>
                    <p class="text-xs text-gray-600">Super User</p>
                </div>
            </div>
        </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 p-6 overflow-y-auto">
        <header class="flex justify-between items-center mb-8">
            <div>
                <h1 class="text-2xl font-bold text-white mb-1">Dashboard</h1>
                <p class="text-gray-500 text-sm">
                    Manage your PocketBase instances
                </p>
            </div>
            <div class="flex items-center gap-3">
                <a
                    href="https://pocketbase.io/docs"
                    target="_blank"
                    rel="noopener"
                    class="px-4 py-2.5 border border-gray-700 hover:bg-gray-800/50 text-gray-300 rounded-lg font-medium text-sm transition-all flex items-center gap-2"
                >
                    <svg
                        class="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><circle cx="11" cy="11" r="8" /><path
                            d="M21 21l-4.35-4.35"
                        /></svg
                    >
                    Search Docs
                </a>
                <button
                    on:click={() => (showAddModal = true)}
                    class="bg-emerald-500 hover:bg-emerald-600 text-black px-5 py-2.5 rounded-lg font-semibold text-sm transition-all"
                >
                    + Create Instance
                </button>
            </div>
        </header>

        {#if error}
            <div
                class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm"
            >
                {error}
                <button
                    on:click={() => (error = null)}
                    class="float-right text-red-400 hover:text-red-300"
                    >&times;</button
                >
            </div>
        {/if}

        <!-- Stats Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
                <p
                    class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1"
                >
                    Total Instances
                </p>
                <h3 class="text-2xl font-bold text-white">{stats.total}</h3>
            </div>
            <div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
                <p
                    class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1"
                >
                    Running
                </p>
                <h3 class="text-2xl font-bold text-emerald-400">
                    {stats.running}
                </h3>
            </div>
            <div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
                <p
                    class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1"
                >
                    Stopped
                </p>
                <h3 class="text-2xl font-bold text-gray-400">
                    {stats.stopped}
                </h3>
            </div>
            {#if systemStats.diskUsage && systemStats.diskUsage !== "0B"}
                <div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
                    <p
                        class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1"
                    >
                        Disk Usage
                    </p>
                    <h3 class="text-2xl font-bold text-white">
                        {systemStats.diskUsage}
                    </h3>
                </div>
            {:else if systemStats.load !== null}
                <div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
                    <p
                        class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1"
                    >
                        Load Avg
                    </p>
                    <h3 class="text-2xl font-bold text-white">
                        {systemStats.load}
                    </h3>
                </div>
            {:else}
                <div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
                    <p
                        class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1"
                    >
                        Healthy
                    </p>
                    <h3 class="text-2xl font-bold text-emerald-400">
                        {instances.filter((i) => i.healthy).length}
                    </h3>
                </div>
            {/if}
        </div>

        <!-- Instance List -->
        {#if loading && instances.length === 0}
            <div
                class="bg-[#111] rounded-xl border border-gray-800/50 p-12 text-center"
            >
                <div
                    class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-emerald-500 border-t-transparent mb-3"
                ></div>
                <p class="text-gray-500 text-sm">Loading instances...</p>
            </div>
        {:else if instances.length === 0}
            <div
                class="bg-[#111] rounded-xl border border-gray-800/50 p-12 text-center"
            >
                <div
                    class="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center mx-auto mb-4"
                >
                    <svg
                        class="w-6 h-6 text-gray-600"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><path
                            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                        /></svg
                    >
                </div>
                <p class="text-gray-400 mb-4">No instances yet</p>
                <button
                    on:click={() => (showAddModal = true)}
                    class="bg-emerald-500 hover:bg-emerald-600 text-black px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                >
                    Create your first instance
                </button>
            </div>
        {:else}
            <div
                class="bg-[#111] rounded-xl border border-gray-800/50 overflow-hidden"
            >
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr
                                class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-800/50"
                            >
                                <th class="px-6 py-4">Instance</th>
                                <th class="px-6 py-4">Status</th>
                                <th class="px-6 py-4">Port</th>
                                <th class="px-6 py-4">Version</th>
                                <th class="px-6 py-4">Size</th>
                                {#if instances.some((i) => i.created)}
                                    <th class="px-6 py-4">Created</th>
                                {/if}
                                <th class="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-800/50">
                            {#each instances as instance}
                                <tr
                                    class="hover:bg-white/[0.02] transition-colors"
                                >
                                    <td class="px-6 py-4">
                                        <a
                                            href="/dashboard/{instance.name}"
                                            class="flex items-center gap-3 group"
                                        >
                                            <div
                                                class="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:bg-emerald-500/20 group-hover:text-emerald-400 transition-all"
                                            >
                                                {instance.name
                                                    .charAt(0)
                                                    .toUpperCase()}
                                            </div>
                                            <span
                                                class="font-medium text-white group-hover:text-emerald-400 transition-all"
                                                >{instance.name}</span
                                            >
                                        </a>
                                    </td>
                                    <td class="px-6 py-4">
                                        <span
                                            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium {instance.status ===
                                            'running'
                                                ? 'bg-emerald-500/10 text-emerald-400'
                                                : 'bg-gray-700/50 text-gray-400'}"
                                        >
                                            <span
                                                class="w-1.5 h-1.5 rounded-full {instance.status ===
                                                'running'
                                                    ? 'bg-emerald-400'
                                                    : 'bg-gray-500'}"
                                            ></span>
                                            {instance.status}
                                        </span>
                                    </td>
                                    <td
                                        class="px-6 py-4 text-sm text-gray-400 font-mono"
                                        >{instance.port}</td
                                    >
                                    <td class="px-6 py-4">
                                        <span
                                            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-700/50 text-gray-400"
                                        >
                                            {instance.version || "unknown"}
                                        </span>
                                    </td>
                                    <td class="px-6 py-4 text-sm text-gray-400"
                                        >
                                            <span class={instance.overQuota ? "text-orange-400" : ""}>{instance.size || "-"}</span>
                                            {#if instance.sizeLimit}
                                                <span class="text-gray-600 text-xs ml-1">/ {instance.sizeLimit}</span>
                                            {/if}
                                            {#if instance.overQuota}
                                                <span class="ml-1 text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">Over limit</span>
                                            {/if}
                                        </td>
                                    {#if instances.some((i) => i.created)}
                                        <td
                                            class="px-6 py-4 text-sm text-gray-500"
                                        >
                                            {instance.created
                                                ? new Date(
                                                      instance.created,
                                                  ).toLocaleDateString()
                                                : "-"}
                                        </td>
                                    {/if}
                                    <td class="px-6 py-4">
                                        <div class="flex justify-end gap-1">
                                            <a
                                                href="/dashboard/{instance.name}"
                                                class="p-2 hover:bg-gray-700 rounded-lg transition-all text-gray-500 hover:text-white"
                                                title="Manage"
                                            >
                                                <svg
                                                    class="w-4 h-4"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    ><path
                                                        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
                                                    /><path
                                                        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
                                                    /></svg
                                                >
                                            </a>
                                            <a
                                                href="/{instance.name}/_/"
                                                target="_blank"
                                                rel="noopener"
                                                class="p-2 hover:bg-emerald-500/10 hover:text-emerald-400 rounded-lg transition-all text-gray-500"
                                                title="Open Admin"
                                            >
                                                <svg
                                                    class="w-4 h-4"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    ><path
                                                        d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
                                                    /></svg
                                                >
                                            </a>
                                            <button
                                                on:click={() =>
                                                    toggleInstance(
                                                        instance.name,
                                                        instance.status ===
                                                            "running"
                                                            ? "stop"
                                                            : "start",
                                                    )}
                                                class="p-2 hover:bg-blue-500/10 hover:text-blue-400 rounded-lg transition-all text-gray-500"
                                                title={instance.status ===
                                                "running"
                                                    ? "Stop"
                                                    : "Start"}
                                            >
                                                <svg
                                                    class="w-4 h-4"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                >
                                                    {#if instance.status === "running"}
                                                        <rect
                                                            x="6"
                                                            y="4"
                                                            width="4"
                                                            height="16"
                                                        /><rect
                                                            x="14"
                                                            y="4"
                                                            width="4"
                                                            height="16"
                                                        />
                                                    {:else}
                                                        <path
                                                            d="M5 3l14 9-14 9V3z"
                                                        />
                                                    {/if}
                                                </svg>
                                            </button>
                                            <button
                                                on:click={() =>
                                                    removeInstance(
                                                        instance.name,
                                                    )}
                                                class="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all text-gray-500"
                                                title="Delete"
                                            >
                                                <svg
                                                    class="w-4 h-4"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    ><path
                                                        d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                                                    /></svg
                                                >
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {/if}
    </main>
</div>

<!-- Add Modal -->
{#if showAddModal}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        on:click|self={() => (showAddModal = false)}
    >
        <div
            class="bg-[#111] rounded-2xl p-6 w-full max-w-md border border-gray-800"
        >
            <h2 class="text-xl font-bold text-white mb-5">Create Instance</h2>
            <div>
                <label
                    for="instance-name"
                    class="block text-xs font-medium text-gray-500 uppercase mb-2"
                    >Instance Name</label
                >
                <input
                    id="instance-name"
                    type="text"
                    bind:value={newInstanceName}
                    placeholder="my-app"
                    class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500/50 transition-all text-white placeholder-gray-600"
                    on:keydown={(e) =>
                        e.key === "Enter" && !showAdvanced && addInstance()}
                />
                <p class="text-xs text-gray-600 mt-2">
                    Lowercase letters, numbers, and hyphens only
                </p>
            </div>

            <!-- Advanced Options -->
            <div class="mt-4">
                <button
                    type="button"
                    on:click={() => (showAdvanced = !showAdvanced)}
                    class="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-all"
                >
                    <svg
                        class="w-4 h-4 transition-transform {showAdvanced
                            ? 'rotate-90'
                            : ''}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"><path d="M9 18l6-6-6-6" /></svg
                    >
                    Advanced Options
                </button>

                {#if showAdvanced}
                    <div
                        class="mt-4 space-y-4 pl-1 border-l-2 border-gray-800 ml-1.5"
                    >
                        <div class="pl-4">
                            <label
                                for="custom-port"
                                class="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >Port</label
                            >
                            <input
                                id="custom-port"
                                type="text"
                                bind:value={customPort}
                                on:blur={() => checkPort(customPort)}
                                placeholder="Auto-assign (30000-39999)"
                                class="w-full bg-[#0a0a0a] border rounded-lg px-4 py-2.5 focus:outline-none transition-all text-white placeholder-gray-600 text-sm
                                    {portError
                                    ? 'border-red-500/50'
                                    : 'border-gray-800 focus:border-emerald-500/50'}"
                            />
                            {#if portError}
                                <p class="text-xs text-red-400 mt-1">
                                    {portError}
                                </p>
                            {:else if portChecking}
                                <p class="text-xs text-gray-500 mt-1">
                                    Checking...
                                </p>
                            {:else}
                                <p class="text-xs text-gray-600 mt-1">
                                    Leave empty for auto-assign
                                </p>
                            {/if}
                        </div>

                        <div class="pl-4">
                            <label
                                for="custom-email"
                                class="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >Admin Email</label
                            >
                            <input
                                id="custom-email"
                                type="email"
                                bind:value={customEmail}
                                placeholder="admin@instance.local"
                                class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white placeholder-gray-600 text-sm"
                            />
                        </div>

                        <div class="pl-4">
                            <label
                                for="custom-password"
                                class="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >Admin Password</label
                            >
                            <input
                                id="custom-password"
                                type="password"
                                bind:value={customPassword}
                                placeholder="changeme123"
                                class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white placeholder-gray-600 text-sm"
                            />
                            <p class="text-xs text-gray-600 mt-1">
                                Min 8 characters recommended
                            </p>
                        </div>

                        <div class="pl-4">
                            <label
                                for="custom-size-limit"
                                class="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >Database Size Limit</label
                            >
                            <input
                                id="custom-size-limit"
                                type="text"
                                bind:value={customSizeLimit}
                                placeholder="e.g. 500MB, 1GB (optional)"
                                class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white placeholder-gray-600 text-sm"
                            />
                            <p class="text-xs text-gray-600 mt-1">Optional. Alerts when exceeded.</p>
                        </div>

                        <div class="pl-4">
                            <label
                                for="version-select"
                                class="block text-xs font-medium text-gray-500 uppercase mb-2"
                                >PocketBase Version</label
                            >
                            {#if loadingVersions}
                                <div
                                    class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 text-gray-500 text-sm"
                                >
                                    Loading versions...
                                </div>
                            {:else}
                                <select
                                    id="version-select"
                                    bind:value={selectedVersion}
                                    class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white text-sm"
                                >
                                    {#if latestVersion}
                                        <option value={latestVersion}
                                            >{latestVersion} (latest)</option
                                        >
                                    {/if}
                                    {#each installedVersions.filter((v) => v !== latestVersion) as version}
                                        <option value={version}
                                            >{version}</option
                                        >
                                    {/each}
                                    {#each availableVersions
                                        .slice(0, 10)
                                        .filter((v) => !installedVersions.includes(v) && v !== latestVersion) as version}
                                        <option value={version}
                                            >{version} (download)</option
                                        >
                                    {/each}
                                </select>
                                <p class="text-xs text-gray-600 mt-1">
                                    Version will be downloaded if not installed
                                </p>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>

            <div class="flex gap-3 mt-6">
                <button
                    on:click={() => {
                        showAddModal = false;
                        newInstanceName = "";
                        customPort = "";
                        customEmail = "";
                        customPassword = "";
                        showAdvanced = false;
                        portError = "";
                    }}
                    class="flex-1 px-4 py-2.5 border border-gray-700 rounded-lg font-medium text-gray-400 hover:bg-gray-800/50 transition-all text-sm"
                >
                    Cancel
                </button>
                <button
                    on:click={addInstance}
                    class="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg font-semibold transition-all text-sm"
                    disabled={creating ||
                        !newInstanceName.trim() ||
                        !!portError}
                >
                    {creating ? "Creating..." : "Create"}
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Credentials Modal -->
{#if showCredsModal && lastCreatedCreds}
    <div
        class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
    >
        <div
            class="bg-[#111] rounded-2xl p-6 w-full max-w-lg border border-emerald-500/20 relative"
        >
            <div
                class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-t-2xl"
            ></div>

            <div class="flex items-center gap-3 mb-5">
                <div
                    class="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center"
                >
                    <svg
                        class="w-5 h-5 text-emerald-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><path
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        /></svg
                    >
                </div>
                <div>
                    <h2 class="text-lg font-bold text-white">
                        Instance Created
                    </h2>
                    <p class="text-sm text-gray-500">{lastCreatedCreds.name}</p>
                </div>
            </div>

            <p class="text-gray-400 text-sm mb-5">
                Save these credentials to access the PocketBase admin panel.
            </p>

            <div class="space-y-3 mb-6">
                <div class="bg-[#0a0a0a] rounded-xl p-4 border border-gray-800">
                    <p
                        class="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1"
                    >
                        Email
                    </p>
                    <p class="font-mono text-emerald-400 text-sm">
                        {lastCreatedCreds.email}
                    </p>
                </div>
                <div class="bg-[#0a0a0a] rounded-xl p-4 border border-gray-800">
                    <p
                        class="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1"
                    >
                        Password
                    </p>
                    <p class="font-mono text-emerald-400 text-sm">
                        {lastCreatedCreds.password}
                    </p>
                </div>
            </div>

            <div class="flex gap-3">
                <a
                    href="/{lastCreatedCreds.name}/_/"
                    target="_blank"
                    rel="noopener"
                    class="flex-1 px-4 py-2.5 border border-gray-700 rounded-lg font-medium text-gray-300 hover:bg-gray-800/50 transition-all text-sm text-center"
                >
                    Open Admin
                </a>
                <button
                    on:click={() => (showCredsModal = false)}
                    class="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg font-semibold transition-all text-sm"
                >
                    Done
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    :global(body) {
        background-color: #0a0a0a;
    }
</style>
