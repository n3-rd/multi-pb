<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { apiFetch } from '$lib/api';
	import LogsPanel from './LogsPanel.svelte';

	let instance = null;
	let loading = true;
	let error: string | null = null;
	let activeTab = 'overview';

	// Settings
	let showSettingsModal = false;
	let settingsSizeLimit = '';
	let settingsMemory = '';
	let savingSettings = false;
	let actionLoading = '';

	// Backups
	let backups: { name: string; size?: string; created?: string }[] = [];
	let creatingBackup = false;
	let restoringBackup: string | null = null;

	// Version management
	let showVersionModal = false;
	let availableVersions: string[] = [];
	let installedVersions: string[] = [];
	let latestVersion = '';
	let selectedUpgradeVersion = '';
	let upgrading = false;
	let loadingVersions = false;

	$: instanceName = $page.params.name;

	async function fetchInstance() {
		try {
			const res = await apiFetch(`/instances/${instanceName}`);
			if (!res.ok) throw new Error('Failed to fetch instance');
			instance = await res.json();
			backups = instance.backups || [];
			error = null;
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function toggleInstance(action) {
		actionLoading = action;
		try {
			const res = await apiFetch(`/instances/${instanceName}/${action}`, { method: 'POST' });
			if (!res.ok) throw new Error(`Failed to ${action}`);
			await fetchInstance();
		} catch (e) {
			error = e.message;
		} finally {
			actionLoading = '';
		}
	}

	async function createBackup() {
		creatingBackup = true;
		try {
			const res = await apiFetch(`/instances/${instanceName}/backups`, { method: 'POST' });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error || 'Failed to create backup');
			backups = [result.backup, ...backups];
		} catch (e) {
			error = e.message;
		} finally {
			creatingBackup = false;
		}
	}

	async function deleteBackup(backupName) {
		if (!confirm(`Delete backup "${backupName}"?`)) return;
		try {
			const res = await apiFetch(`/instances/${instanceName}/backups/${backupName}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Failed to delete backup');
			backups = backups.filter(b => b.name !== backupName);
		} catch (e) {
			error = e.message;
		}
	}

	async function downloadBackup(backupName: string) {
		try {
			const res = await apiFetch(`/instances/${instanceName}/backups/${backupName}/download`);
			if (!res.ok) throw new Error('Download failed');
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = backupName;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Download failed';
		}
	}

	async function restoreBackup(backupName: string) {
		if (!confirm(`Restore "${backupName}"? This will stop the instance, replace all data, and restart.`)) return;
		restoringBackup = backupName;
		try {
			const res = await apiFetch(`/instances/${instanceName}/backups/${backupName}/restore`, { method: 'POST' });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error || 'Failed to restore');
			await fetchInstance();
		} catch (e) {
			error = e.message;
		} finally {
			restoringBackup = null;
		}
	}

	async function fetchVersions() {
		loadingVersions = true;
		try {
			const latestRes = await apiFetch('/versions/latest');
			if (latestRes.ok) {
				const data = await latestRes.json();
				latestVersion = data.version || '';
			}

			const installedRes = await apiFetch('/versions/installed');
			if (installedRes.ok) {
				const data = await installedRes.json();
				installedVersions = data.versions || [];
			}

			const availableRes = await apiFetch('/versions/available');
			if (availableRes.ok) {
				const data = await availableRes.json();
				availableVersions = data.versions || [];
			}

			// Set default selected version to current or latest
			selectedUpgradeVersion = instance?.version || latestVersion;
		} catch (e) {
			console.error('Failed to fetch versions:', e);
		} finally {
			loadingVersions = false;
		}
	}

	async function upgradeInstance() {
		if (!selectedUpgradeVersion) return;
		if (selectedUpgradeVersion === instance?.version) {
			showVersionModal = false;
			return;
		}

		if (!confirm(`Upgrade instance to v${selectedUpgradeVersion}? The instance will be stopped, upgraded, and restarted.`)) return;

		upgrading = true;
		try {
			const res = await apiFetch(`/instances/${instanceName}/upgrade`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ version: selectedUpgradeVersion })
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error || 'Failed to upgrade');
			await fetchInstance();
			showVersionModal = false;
		} catch (e) {
			error = e.message;
		} finally {
			upgrading = false;
		}
	}

	function openVersionModal() {
		selectedUpgradeVersion = instance?.version || latestVersion;
		fetchVersions();
		showVersionModal = true;
	}

	function openSettingsModal() {
		settingsSizeLimit = instance?.sizeLimit ?? '';
		settingsMemory = instance?.memory ?? '';
		showSettingsModal = true;
	}

	async function saveSettings() {
		savingSettings = true;
		try {
			const res = await apiFetch(`/instances/${instanceName}/settings`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sizeLimit: settingsSizeLimit.trim() || undefined,
					memory: settingsMemory.trim() || undefined
				})
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error || 'Failed to save settings');
			instance = { ...instance, ...result };
			showSettingsModal = false;
		} catch (e) {
			error = e.message;
		} finally {
			savingSettings = false;
		}
	}

	onMount(() => {
		fetchInstance();
	});

	function formatDate(dateStr) {
		if (!dateStr) return '-';
		return new Date(dateStr).toLocaleString();
	}
</script>

<div class="min-h-screen bg-[#0a0a0a] text-gray-100 p-6">
	<div class="max-w-6xl mx-auto">
		<!-- Header -->
		<div class="flex items-center justify-between mb-8">
			<div class="flex items-center gap-4">
				<a href="/dashboard" class="p-2 hover:bg-gray-800 rounded-lg transition-all text-gray-500 hover:text-white">
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
				</a>
				<div>
					<h1 class="text-2xl font-bold text-white">{instanceName}</h1>
					{#if instance}
						<div class="flex items-center gap-3 mt-1">
							<span class="inline-flex items-center gap-1.5 text-sm {instance.status === 'running' ? 'text-emerald-400' : 'text-gray-500'}">
								<span class="w-2 h-2 rounded-full {instance.status === 'running' ? 'bg-emerald-400' : 'bg-gray-600'}"></span>
								{instance.status}
							</span>
							<span class="text-gray-600">•</span>
							<span class="text-sm text-gray-500">Port {instance.port}</span>
							<span class="text-gray-600">•</span>
							<span class="text-sm text-gray-500">{instance.size}</span>
						</div>
					{/if}
				</div>
			</div>
			
			{#if instance}
				<div class="flex items-center gap-2">
					<a href="/{instanceName}/_/" target="_blank" rel="noopener" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-all flex items-center gap-2">
						<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
						Open Admin
					</a>
					{#if instance.status === 'running'}
						<button on:click={() => toggleInstance('stop')} disabled={!!actionLoading} class="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg text-sm font-medium transition-all disabled:opacity-50">
							{actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
						</button>
						<button on:click={() => toggleInstance('restart')} disabled={!!actionLoading} class="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm font-medium transition-all disabled:opacity-50">
							{actionLoading === 'restart' ? 'Restarting...' : 'Restart'}
						</button>
					{:else}
						<button on:click={() => toggleInstance('start')} disabled={!!actionLoading} class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg text-sm font-semibold transition-all disabled:opacity-50">
							{actionLoading === 'start' ? 'Starting...' : 'Start'}
						</button>
					{/if}
				</div>
			{/if}
		</div>

		{#if error}
			<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
				{error}
				<button on:click={() => error = null} class="float-right">&times;</button>
			</div>
		{/if}

		{#if loading}
			<div class="bg-[#111] rounded-xl border border-gray-800/50 p-12 text-center">
				<div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-emerald-500 border-t-transparent"></div>
			</div>
		{:else if instance}
			<!-- Tabs -->
			<div class="flex gap-1 mb-6 bg-[#111] p-1 rounded-xl w-fit border border-gray-800/50">
				{#each ['overview', 'backups', 'logs'] as tab}
					<button 
						on:click={() => activeTab = tab}
						class="px-5 py-2.5 rounded-lg text-sm font-medium transition-all capitalize
							{activeTab === tab ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}"
					>
						{tab}
					</button>
				{/each}
			</div>

			<!-- Tab Content -->
			{#if activeTab === 'overview'}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
					<div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
						<p class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Status</p>
						<p class="text-lg font-semibold {instance.status === 'running' ? 'text-emerald-400' : 'text-gray-400'}">{instance.status}</p>
					</div>
					<div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
						<p class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Health</p>
						<p class="text-lg font-semibold {instance.healthy ? 'text-emerald-400' : 'text-red-400'}">{instance.healthy ? 'Healthy' : 'Unhealthy'}</p>
					</div>
					<div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
						<p class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Data Size</p>
						<p class="text-lg font-semibold {instance.overQuota ? 'text-orange-400' : 'text-white'}">{instance.size}{instance.sizeLimit ? ` / ${instance.sizeLimit}` : ''}</p>
						{#if instance.overQuota}
							<p class="text-xs text-orange-400 mt-1">Over size limit</p>
						{/if}
					</div>
					<div class="bg-[#111] p-5 rounded-xl border border-gray-800/50">
						<p class="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Backups</p>
						<p class="text-lg font-semibold text-white">{backups.length}</p>
					</div>
				</div>

				<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<div class="bg-[#111] rounded-xl border border-gray-800/50 p-6">
						<h3 class="text-sm font-semibold text-white mb-4 uppercase tracking-wide">Quick Actions</h3>
						<div class="space-y-3">
							<a href="/{instanceName}/_/" target="_blank" rel="noopener" class="flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-all group">
								<div class="flex items-center gap-3">
									<div class="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
										<svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/></svg>
									</div>
									<span class="text-gray-300 group-hover:text-white">Admin Dashboard</span>
								</div>
								<svg class="w-4 h-4 text-gray-600 group-hover:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
							</a>
							<button on:click={() => activeTab = 'backups'} class="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-all group">
								<div class="flex items-center gap-3">
									<div class="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
										<svg class="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
									</div>
									<span class="text-gray-300 group-hover:text-white">Manage Backups</span>
								</div>
								<svg class="w-4 h-4 text-gray-600 group-hover:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
							</button>
							<button on:click={() => activeTab = 'logs'} class="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-all group">
								<div class="flex items-center gap-3">
									<div class="w-8 h-8 bg-orange-500/10 rounded-lg flex items-center justify-center">
										<svg class="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
									</div>
									<span class="text-gray-300 group-hover:text-white">View Logs</span>
								</div>
								<svg class="w-4 h-4 text-gray-600 group-hover:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
							</button>
						</div>
					</div>

					<div class="bg-[#111] rounded-xl border border-gray-800/50 p-6">
						<h3 class="text-sm font-semibold text-white mb-4 uppercase tracking-wide">Instance Info</h3>
						<dl class="space-y-3">
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">Name</dt>
								<dd class="text-white font-mono">{instance.name}</dd>
							</div>
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">Port</dt>
								<dd class="text-white font-mono">{instance.port}</dd>
							</div>
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">Version</dt>
								<dd class="flex items-center gap-2">
									<span class="text-white font-mono">{instance.version || 'unknown'}</span>
									<button on:click={openVersionModal} class="text-xs px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded transition-all">
										Change
									</button>
								</dd>
							</div>
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">Created</dt>
								<dd class="text-white">{formatDate(instance.created)}</dd>
							</div>
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">Size Limit</dt>
								<dd class="flex items-center gap-2">
									<span class="text-white font-mono">{instance.sizeLimit || '—'}</span>
									<button on:click={openSettingsModal} class="text-xs px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded transition-all">
										{instance.sizeLimit ? 'Edit' : 'Set'}
									</button>
								</dd>
							</div>
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">Memory Limit</dt>
								<dd class="flex items-center gap-2">
									<span class="text-white font-mono">{instance.memory || '—'}</span>
									<button on:click={openSettingsModal} class="text-xs px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded transition-all">
										Edit
									</button>
								</dd>
							</div>
							<div class="flex justify-between py-2 border-b border-gray-800/50">
								<dt class="text-gray-500">URL Path</dt>
								<dd class="text-emerald-400 font-mono">/{instance.name}/</dd>
							</div>
							<div class="flex justify-between py-2">
								<dt class="text-gray-500">Admin URL</dt>
								<dd class="text-emerald-400 font-mono">/{instance.name}/_/</dd>
							</div>
						</dl>
					</div>
				</div>

			{:else if activeTab === 'backups'}
				<div class="bg-[#111] rounded-xl border border-gray-800/50 overflow-hidden">
					<div class="flex items-center justify-between p-4 border-b border-gray-800/50">
						<h3 class="text-sm font-semibold text-white uppercase tracking-wide">Backups</h3>
						<button on:click={createBackup} disabled={creatingBackup} class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg text-sm font-semibold transition-all disabled:opacity-50">
							{creatingBackup ? 'Creating...' : '+ Create Backup'}
						</button>
					</div>
					
					{#if backups.length === 0}
						<div class="p-12 text-center">
							<div class="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center mx-auto mb-4">
								<svg class="w-6 h-6 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
							</div>
							<p class="text-gray-500 mb-4">No backups yet</p>
							<button on:click={createBackup} disabled={creatingBackup} class="bg-emerald-500 hover:bg-emerald-600 text-black px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50">
								Create First Backup
							</button>
						</div>
					{:else}
						<div class="divide-y divide-gray-800/50">
							{#each backups as backup}
								<div class="flex items-center justify-between p-4 hover:bg-white/[0.02]">
									<div class="flex items-center gap-4">
										<div class="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
											<svg class="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
										</div>
										<div>
											<p class="text-white font-medium text-sm">{backup.name}</p>
											<p class="text-gray-500 text-xs">{formatDate(backup.created)} • {backup.size}</p>
										</div>
									</div>
									<div class="flex items-center gap-2">
										<button type="button" on:click={() => downloadBackup(backup.name)} class="p-2 hover:bg-gray-800 rounded-lg transition-all text-gray-500 hover:text-white" title="Download">
											<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
										</button>
										<button on:click={() => restoreBackup(backup.name)} disabled={restoringBackup === backup.name} class="p-2 hover:bg-blue-500/10 hover:text-blue-400 rounded-lg transition-all text-gray-500 disabled:opacity-50" title="Restore">
											{#if restoringBackup === backup.name}
												<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
											{:else}
												<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5M21 21v-5h-5"/></svg>
											{/if}
										</button>
										<button on:click={() => deleteBackup(backup.name)} class="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all text-gray-500" title="Delete">
											<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

			{:else if activeTab === 'logs'}
				<LogsPanel {instanceName} />
			{/if}
		{/if}
	</div>
</div>

<!-- Version Upgrade Modal -->
{#if showVersionModal}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" on:click|self={() => showVersionModal = false}>
		<div class="bg-[#111] rounded-2xl p-6 w-full max-w-md border border-gray-800">
			<h2 class="text-xl font-bold text-white mb-5">Change PocketBase Version</h2>
			
			<div class="mb-4">
				<p class="text-sm text-gray-400 mb-2">Current version: <span class="text-white font-mono">{instance?.version || 'unknown'}</span></p>
				{#if latestVersion}
					<p class="text-xs text-gray-500">Latest version: <span class="text-emerald-400 font-mono">{latestVersion}</span></p>
				{/if}
			</div>

			<div class="mb-6">
				<label for="upgrade-version" class="block text-xs font-medium text-gray-500 uppercase mb-2">Select Version</label>
				{#if loadingVersions}
					<div class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 text-gray-500 text-sm">
						Loading versions...
					</div>
				{:else}
					<select
						id="upgrade-version"
						bind:value={selectedUpgradeVersion}
						class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white text-sm"
					>
						{#if latestVersion}
							<option value={latestVersion}>{latestVersion} (latest)</option>
						{/if}
						{#each installedVersions.filter(v => v !== latestVersion) as version}
							<option value={version}>{version}</option>
						{/each}
						{#each availableVersions.slice(0, 15).filter(v => !installedVersions.includes(v) && v !== latestVersion) as version}
							<option value={version}>{version} (download)</option>
						{/each}
					</select>
					<p class="text-xs text-gray-600 mt-1">Version will be downloaded if not installed</p>
				{/if}
			</div>

			<div class="flex gap-3">
				<button on:click={() => showVersionModal = false} class="flex-1 px-4 py-2.5 border border-gray-700 rounded-lg font-medium text-gray-400 hover:bg-gray-800/50 transition-all text-sm">
					Cancel
				</button>
				<button on:click={upgradeInstance} disabled={upgrading || !selectedUpgradeVersion || selectedUpgradeVersion === instance?.version} class="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg font-semibold transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed">
					{upgrading ? 'Upgrading...' : 'Upgrade'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Settings Modal -->
{#if showSettingsModal}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" on:click|self={() => showSettingsModal = false}>
		<div class="bg-[#111] rounded-2xl p-6 w-full max-w-md border border-gray-800">
			<h2 class="text-xl font-bold text-white mb-5">Instance Settings</h2>

			<div class="space-y-4 mb-6">
				<div>
					<label for="settings-size-limit" class="block text-xs font-medium text-gray-500 uppercase mb-2">Database Size Limit</label>
					<input
						id="settings-size-limit"
						type="text"
						bind:value={settingsSizeLimit}
						placeholder="e.g. 500MB, 1GB, 1GiB"
						class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white placeholder-gray-600 text-sm"
					/>
					<p class="text-xs text-gray-600 mt-1">Leave empty for no limit. Alerts when exceeded.</p>
				</div>
				<div>
					<label for="settings-memory" class="block text-xs font-medium text-gray-500 uppercase mb-2">Memory Limit (GOMEMLIMIT)</label>
					<input
						id="settings-memory"
						type="text"
						bind:value={settingsMemory}
						placeholder="e.g. 128MB, 512MB, 1GiB"
						class="w-full bg-[#0a0a0a] border border-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-all text-white placeholder-gray-600 text-sm"
					/>
					<p class="text-xs text-gray-600 mt-1">Restarts instance to apply.</p>
				</div>
			</div>

			<div class="flex gap-3">
				<button on:click={() => showSettingsModal = false} class="flex-1 px-4 py-2.5 border border-gray-700 rounded-lg font-medium text-gray-400 hover:bg-gray-800/50 transition-all text-sm">
					Cancel
				</button>
				<button on:click={saveSettings} disabled={savingSettings} class="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg font-semibold transition-all text-sm disabled:opacity-50">
					{savingSettings ? 'Saving...' : 'Save'}
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
