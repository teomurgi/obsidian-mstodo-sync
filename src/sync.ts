import { App, TFile, Notice } from 'obsidian';
import { MSToDoAuth } from './auth';
import { TaskParser, ObsidianTask, MSToDoTask } from './parser';

/**
 * Task Synchronization Engine
 * Handles bidirectional synchronization between Obsidian tasks and Microsoft To Do
 * Features advanced conflict resolution using state tracking to prevent sync loops
 */
export class TaskSync {
	private parser: TaskParser;
	/** Set of task IDs that were recently updated to prevent sync loops */
	private recentlyUpdatedTasks = new Set<string>();
	/** Map of last known task states for change detection */
	private lastKnownStates = new Map<string, { completed: boolean, lastSync: number }>();

	/**
	 * Initialize the sync engine
	 * @param auth - Authentication handler for Microsoft Graph API
	 * @param app - Obsidian app instance for file operations
	 */
	constructor(private auth: MSToDoAuth, private app: App) {
		this.parser = new TaskParser();
	}

	/**
	 * Make an authenticated request to Microsoft Graph API
	 * @param endpoint - API endpoint path (e.g., '/me/todo/lists')
	 * @param method - HTTP method (default: GET)
	 * @param body - Request body for POST/PATCH requests
	 * @returns Promise resolving to API response data
	 * @throws Error if API request fails
	 */
	private async makeGraphRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
		const token = await this.auth.getAccessToken();
		
		console.log('Making Graph API request:', {
			endpoint,
			method,
			tokenPrefix: token.substring(0, 20) + '...',
			tokenLength: token.length,
			tokenParts: token.split('.').length
		});
		
		const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
			method,
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: body ? JSON.stringify(body) : undefined
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('Graph API error:', {
				status: response.status,
				statusText: response.statusText,
				error: errorText,
				endpoint
			});
			throw new Error(`Graph API error: ${response.status} ${errorText}`);
		}

		return await response.json();
	}

	/**
	 * Perform bidirectional synchronization between Obsidian and Microsoft To Do
	 * Uses advanced conflict resolution to prevent sync loops and handle concurrent edits
	 */
	async performBidirectionalSync(): Promise<void> {
		// Add a delay to ensure any recent file changes are saved
		// This is important when sync is triggered immediately after task state changes
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Clear recently updated tasks with a delay buffer for very rapid syncs
		setTimeout(() => {
			this.recentlyUpdatedTasks.clear();
		}, 2000);

		try {
			// Get all tasks from both sources in parallel
			const [obsidianTasks, msToDoTasks] = await Promise.all([
				this.getAllObsidianTasks(),
				this.getAllMSToDoTasks()
			]);

			// Perform conflict resolution and sync
			await this.syncTasks(obsidianTasks, msToDoTasks);
		} catch (error) {
			console.error('Sync failed:', error);
			throw error;
		}
	}

	private async getAllObsidianTasks(): Promise<ObsidianTask[]> {
		const allTasks: ObsidianTask[] = [];
		const markdownFiles = this.app.vault.getMarkdownFiles();

		for (const file of markdownFiles) {
			try {
				// Force read the most current content from disk
				const content = await this.app.vault.read(file);
				const tasks = this.parser.parseObsidianTasks(content, file);
				
				console.log(`Found ${tasks.length} tasks in ${file.path}`);
				if (tasks.length > 0) {
					console.log('Task completion states:', tasks.map(t => ({ 
						text: t.text.substring(0, 30) + '...', 
						completed: t.completed,
						originalLine: t.originalLine
					})));
				}
				
				allTasks.push(...tasks);
			} catch (error) {
				console.warn(`Failed to read file ${file.path}:`, error);
			}
		}

		console.log(`Total Obsidian tasks found: ${allTasks.length}`);
		return allTasks;
	}

	private async getAllMSToDoTasks(): Promise<MSToDoTask[]> {
		try {
			// Get all task lists
			const listsResponse = await this.makeGraphRequest('/me/todo/lists');
			const allTasks: MSToDoTask[] = [];

			// Get tasks from each list
			for (const list of listsResponse.value) {
				try {
					const tasksResponse = await this.makeGraphRequest(`/me/todo/lists/${list.id}/tasks`);
					allTasks.push(...tasksResponse.value);
				} catch (error) {
					console.warn(`Failed to get tasks from list ${list.displayName}:`, error);
				}
			}

			return allTasks;
		} catch (error) {
			console.error('Failed to get MS To Do tasks:', error);
			throw error;
		}
	}

	private async syncTasks(obsidianTasks: ObsidianTask[], msToDoTasks: MSToDoTask[]): Promise<void> {
		const syncOperations: Promise<void>[] = [];

		// Create maps for efficient lookup
		const obsidianByMSId = new Map<string, ObsidianTask>();
		const msToDoById = new Map<string, MSToDoTask>();
		const msToDoByObsidian = new Map<string, MSToDoTask>();

		// Index tasks
		for (const task of obsidianTasks) {
			if (task.msToDoId) {
				obsidianByMSId.set(task.msToDoId, task);
			}
		}

		for (const task of msToDoTasks) {
			msToDoById.set(task.id, task);
			if (task.obsidianFile && task.obsidianLine !== undefined) {
				const key = `${task.obsidianFile}:${task.obsidianLine}`;
				msToDoByObsidian.set(key, task);
			}
		}

		// Process Obsidian tasks
		for (const obsidianTask of obsidianTasks) {
			if (obsidianTask.msToDoId) {
				// Existing linked task - check for updates
				const msTask = msToDoById.get(obsidianTask.msToDoId);
				if (msTask) {
					syncOperations.push(this.syncExistingTask(obsidianTask, msTask));
				} else {
					// MS To Do task was deleted - remove link from Obsidian
					syncOperations.push(this.unlinkDeletedTask(obsidianTask));
				}
			} else {
				// New Obsidian task - create in MS To Do
				syncOperations.push(this.createMSToDoTask(obsidianTask));
			}
		}

		// Process MS To Do tasks that don't have Obsidian counterparts
		for (const msTask of msToDoTasks) {
			// Check if we already have this MS To Do task linked to an Obsidian task
			if (!obsidianByMSId.has(msTask.id)) {
				// New MS To Do task - create in Obsidian
				syncOperations.push(this.createObsidianTask(msTask));
			}
		}

		// Execute all sync operations
		await Promise.allSettled(syncOperations);
	}

	private async syncExistingTask(obsidianTask: ObsidianTask, msTask: MSToDoTask): Promise<void> {
		// Skip if this task was recently updated to prevent sync loops
		if (this.recentlyUpdatedTasks.has(msTask.id)) {
			console.log(`Skipping recently updated task: ${msTask.id}`);
			return;
		}

		// Compare task states instead of timestamps to avoid conflicts with other plugins
		const obsidianState = {
			completed: obsidianTask.completed,
			title: this.parser.cleanTaskText(obsidianTask.text),
			priority: obsidianTask.priority || 'normal',
			dueDate: obsidianTask.dueDate?.toISOString().split('T')[0] || null
		};
		
		const msState = {
			completed: msTask.status === 'completed',
			title: msTask.title,
			priority: msTask.importance,
			dueDate: msTask.dueDateTime ? new Date(msTask.dueDateTime.dateTime).toISOString().split('T')[0] : null
		};

		console.log('Comparing task states:', {
			taskId: msTask.id,
			originalObsidianLine: obsidianTask.originalLine,
			originalObsidianText: obsidianTask.text,
			cleanedObsidianText: obsidianState.title,
			obsidianCompleted: obsidianState.completed,
			msCompleted: msState.completed,
			msTaskStatus: msTask.status,
			msTaskLastModified: msTask.lastModifiedDateTime,
			obsidianState,
			msState,
			statesMatch: JSON.stringify(obsidianState) === JSON.stringify(msState)
		});

		// Check if states are different
		const statesDifferent = JSON.stringify(obsidianState) !== JSON.stringify(msState);
		
		if (statesDifferent) {
			// Be very conservative about updating Obsidian tasks
			// Only update Obsidian if completion status differs AND there's no Tasks plugin metadata
			const hasTasksPluginMetadata = obsidianTask.text.match(TaskParser.COMPLETION_DATE_REGEX) ||
										   obsidianTask.text.match(TaskParser.START_DATE_REGEX) ||
										   obsidianTask.text.match(TaskParser.SCHEDULED_DATE_REGEX) ||
										   obsidianTask.text.match(TaskParser.RECURRENCE_REGEX);
			
			const completionDiffers = obsidianState.completed !== msState.completed;
			const contentDiffers = obsidianState.title !== msState.title || 
								  obsidianState.priority !== msState.priority || 
								  obsidianState.dueDate !== msState.dueDate;
			
			console.log('Sync decision factors:', {
				completionDiffers,
				contentDiffers,
				hasTasksPluginMetadata: !!hasTasksPluginMetadata,
				obsidianCompleted: obsidianState.completed,
				msCompleted: msState.completed,
				msWasReopened: completionDiffers && !msState.completed && obsidianState.completed,
				msWasCompleted: completionDiffers && msState.completed && !obsidianState.completed,
				obsidianWasReopened: completionDiffers && !obsidianState.completed && msState.completed,
				obsidianWasCompleted: completionDiffers && obsidianState.completed && !msState.completed
			});
			
			if (contentDiffers) {
				// Content changed in Obsidian (title, priority, due date) -> update MS To Do
				console.log('Updating MS To Do (Obsidian content changes)');
				await this.updateMSToDoTask(msTask.id, obsidianTask);
				this.recentlyUpdatedTasks.add(msTask.id);
			} else if (completionDiffers) {
				// Advanced conflict resolution using last known states
				const taskId = msTask.id;
				const lastKnownState = this.lastKnownStates.get(taskId);
				
				// Check if this task was recently updated by us to avoid ping-pong
				const wasRecentlyUpdated = this.recentlyUpdatedTasks.has(taskId);
				
				if (wasRecentlyUpdated) {
					console.log('Skipping completion sync - task was recently updated to prevent sync loops');
					// Update our known state for next time
					this.lastKnownStates.set(taskId, { 
						completed: obsidianState.completed, // Use Obsidian as canonical after our update
						lastSync: Date.now() 
					});
				} else if (lastKnownState) {
					// We have a previous state - determine what changed
					const obsidianChanged = lastKnownState.completed !== obsidianState.completed;
					const msToDoChanged = lastKnownState.completed !== msState.completed;
					
					console.log('State change analysis:', {
						lastKnown: lastKnownState.completed,
						obsidianNow: obsidianState.completed,
						msToDoNow: msState.completed,
						obsidianChanged,
						msToDoChanged
					});
					
					if (obsidianChanged && !msToDoChanged) {
						// Only Obsidian changed
						console.log('Updating MS To Do (Obsidian state changed)');
						await this.updateMSToDoTask(taskId, obsidianTask);
						this.recentlyUpdatedTasks.add(taskId);
						this.lastKnownStates.set(taskId, { completed: obsidianState.completed, lastSync: Date.now() });
					} else if (msToDoChanged && !obsidianChanged) {
						// Only MS To Do changed
						console.log('Updating Obsidian (MS To Do state changed)');
						await this.updateObsidianTask(obsidianTask, msTask);
						this.recentlyUpdatedTasks.add(taskId);
						this.lastKnownStates.set(taskId, { completed: msState.completed, lastSync: Date.now() });
					} else if (obsidianChanged && msToDoChanged) {
						// Both changed (conflict) - use completion bias
						if (obsidianState.completed || msState.completed) {
							const useObsidian = obsidianState.completed;
							console.log(`Conflict resolution - using ${useObsidian ? 'Obsidian' : 'MS To Do'} (completion bias)`);
							
							if (useObsidian) {
								await this.updateMSToDoTask(taskId, obsidianTask);
								this.lastKnownStates.set(taskId, { completed: obsidianState.completed, lastSync: Date.now() });
							} else {
								await this.updateObsidianTask(obsidianTask, msTask);
								this.lastKnownStates.set(taskId, { completed: msState.completed, lastSync: Date.now() });
							}
							this.recentlyUpdatedTasks.add(taskId);
						}
					} else {
						console.log('No changes detected - this should not happen');
					}
				} else {
					// No previous state - use completion bias (completed side wins)
					console.log('No previous state - using completion bias for initial sync');
					if (obsidianState.completed && !msState.completed) {
						console.log('Updating MS To Do (Obsidian completed, no previous state)');
						await this.updateMSToDoTask(taskId, obsidianTask);
						this.recentlyUpdatedTasks.add(taskId);
					} else if (msState.completed && !obsidianState.completed) {
						console.log('Updating Obsidian (MS To Do completed, no previous state)');
						await this.updateObsidianTask(obsidianTask, msTask);
						this.recentlyUpdatedTasks.add(taskId);
					}
					
					// Store the state we decided on
					const finalState = obsidianState.completed || msState.completed;
					this.lastKnownStates.set(taskId, { completed: finalState, lastSync: Date.now() });
				}
			} else {
				console.log('No sync needed for this state difference');
			}
		} else {
			console.log('States match, no sync needed', {
				taskId: msTask.id,
				taskTitle: obsidianState.title.substring(0, 30) + '...',
				bothCompleted: obsidianState.completed && msState.completed,
				bothUncompleted: !obsidianState.completed && !msState.completed
			});
			
			// Update our known state even when no sync is needed
			this.lastKnownStates.set(msTask.id, { 
				completed: obsidianState.completed, 
				lastSync: Date.now() 
			});
		}
	}

	private async createMSToDoTask(obsidianTask: ObsidianTask): Promise<void> {
		try {
			const msTaskData = this.parser.convertObsidianToMSToDoTask(obsidianTask);
			
			// Get or create default list
			const listId = await this.getDefaultListId();
			
			const createdTask = await this.makeGraphRequest(`/me/todo/lists/${listId}/tasks`, 'POST', msTaskData);

			// Update Obsidian task with MS To Do ID
			await this.addMSToDoIdToObsidianTask(obsidianTask, createdTask.id);
		} catch (error) {
			console.error('Failed to create MS To Do task:', error);
		}
	}

	private async createObsidianTask(msTask: MSToDoTask): Promise<void> {
		try {
			// Check if a task with this MS To Do ID already exists in ANY file
			const allTasks = await this.getAllObsidianTasks();
			const existingTask = allTasks.find(task => task.msToDoId === msTask.id);
			
			if (existingTask) {
				console.log(`Task with ID ${msTask.id} already exists in ${existingTask.file.path}, skipping creation`);
				return;
			}
			
			// Find appropriate file or use default
			const targetFile = await this.getTargetFileForNewTask();
			
			// Also check by content matching (fallback for tasks without proper IDs)
			const content = await this.app.vault.read(targetFile);
			if (content.includes(`ms-todo:${msTask.id}`)) {
				console.log(`Task with ID ${msTask.id} already exists in ${targetFile.path} (found by content), skipping creation`);
				return;
			}
			
			const obsidianTask = this.parser.convertMSToDoToObsidianTask(msTask, targetFile);
			
			// Add task to file
			const updatedContent = this.parser.addTaskToContent(content, obsidianTask, 'bottom');
			await this.app.vault.modify(targetFile, updatedContent);

			// Update MS To Do task with Obsidian reference
			await this.updateMSToDoTaskObsidianRef(msTask.id, targetFile.path, obsidianTask.line);
		} catch (error) {
			console.error('Failed to create Obsidian task:', error);
		}
	}

	private async updateMSToDoTask(taskId: string, obsidianTask: ObsidianTask): Promise<void> {
		try {
			const updateData = this.parser.convertObsidianToMSToDoTask(obsidianTask);
			delete updateData.obsidianFile;
			delete updateData.obsidianLine;

			console.log('Updating MS To Do task:', {
				taskId,
				obsidianCompleted: obsidianTask.completed,
				updateData,
				obsidianText: obsidianTask.text.substring(0, 50) + '...'
			});

			const listId = await this.getListIdForTask(taskId);
			const result = await this.makeGraphRequest(`/me/todo/lists/${listId}/tasks/${taskId}`, 'PATCH', updateData);
			
			console.log('MS To Do update result:', {
				taskId,
				success: true,
				newStatus: result.status
			});
		} catch (error) {
			console.error('Failed to update MS To Do task:', {
				taskId,
				error: error.message,
				obsidianTask: obsidianTask.text.substring(0, 50) + '...'
			});
		}
	}

	private async updateObsidianTask(obsidianTask: ObsidianTask, msTask: MSToDoTask): Promise<void> {
		try {
			// Create updated task but preserve existing Tasks plugin metadata
			const updatedTask = this.parser.mergeTaskWithExisting(obsidianTask, msTask);
			updatedTask.line = obsidianTask.line;
			updatedTask.originalLine = obsidianTask.originalLine;

			console.log('Updating Obsidian task while preserving metadata:', {
				original: obsidianTask.text,
				merged: updatedTask.text,
				msCompleted: msTask.status === 'completed',
				obsidianCompleted: updatedTask.completed
			});

			const content = await this.app.vault.read(obsidianTask.file);
			const updatedContent = this.parser.updateTaskInContent(content, obsidianTask, updatedTask);
			await this.app.vault.modify(obsidianTask.file, updatedContent);
		} catch (error) {
			console.error('Failed to update Obsidian task:', error);
		}
	}

	private async unlinkDeletedTask(obsidianTask: ObsidianTask): Promise<void> {
		try {
			// Remove MS To Do ID/link from task text (support both formats)
			const cleanTask = { ...obsidianTask };
			cleanTask.text = cleanTask.text
				.replace(/\s*\[ms-todo:[^\]]+\]/, '') // Old format
				.replace(/\s*\[🔗 MS To Do\]\(ms-todo:[^)]+\)/, ''); // New format
			cleanTask.msToDoId = undefined;

			const content = await this.app.vault.read(obsidianTask.file);
			const updatedContent = this.parser.updateTaskInContent(content, obsidianTask, cleanTask);
			await this.app.vault.modify(obsidianTask.file, updatedContent);
		} catch (error) {
			console.error('Failed to unlink deleted task:', error);
		}
	}

	private async addMSToDoIdToObsidianTask(obsidianTask: ObsidianTask, msToDoId: string): Promise<void> {
		try {
			const updatedTask = { ...obsidianTask };
			updatedTask.text += ` [🔗 MS To Do](ms-todo:${msToDoId})`;
			updatedTask.msToDoId = msToDoId;

			const content = await this.app.vault.read(obsidianTask.file);
			const updatedContent = this.parser.updateTaskInContent(content, obsidianTask, updatedTask);
			await this.app.vault.modify(obsidianTask.file, updatedContent);
		} catch (error) {
			console.error('Failed to add MS To Do ID to Obsidian task:', error);
		}
	}

	private async updateMSToDoTaskObsidianRef(taskId: string, filePath: string, line: number): Promise<void> {
		try {
			// Note: MS To Do doesn't have built-in fields for external references
			// We could store this in the task body or use a custom approach
			const updateData = {
				body: {
					content: `Obsidian: ${filePath}:${line}`,
					contentType: 'text'
				}
			};

			const listId = await this.getListIdForTask(taskId);
			await this.makeGraphRequest(`/me/todo/lists/${listId}/tasks/${taskId}`, 'PATCH', updateData);
		} catch (error) {
			console.error('Failed to update MS To Do task reference:', error);
		}
	}

	private async getDefaultListId(): Promise<string> {
		const listsResponse = await this.makeGraphRequest('/me/todo/lists');
		
		// Look for default list or create one
		for (const list of listsResponse.value) {
			if (list.wellknownListName === 'defaultList' || list.displayName === 'Tasks') {
				return list.id;
			}
		}

		// Return first available list
		if (listsResponse.value.length > 0) {
			return listsResponse.value[0].id;
		}

		throw new Error('No task lists found');
	}

	private async getListIdForTask(taskId: string): Promise<string> {
		const listsResponse = await this.makeGraphRequest('/me/todo/lists');
		
		for (const list of listsResponse.value) {
			try {
				await this.makeGraphRequest(`/me/todo/lists/${list.id}/tasks/${taskId}`);
				return list.id;
			} catch {
				continue;
			}
		}

		throw new Error(`Task ${taskId} not found in any list`);
	}

	private async getTargetFileForNewTask(): Promise<TFile> {
		// Try to find a tasks file or daily note, otherwise use a default
		const files = this.app.vault.getMarkdownFiles();
		
		// Look for common task file names
		const taskFileNames = ['Tasks.md', 'tasks.md', 'TODO.md', 'todo.md'];
		for (const fileName of taskFileNames) {
			const file = files.find(f => f.name === fileName);
			if (file) return file;
		}

		// Look for today's daily note
		const today = new Date().toISOString().split('T')[0];
		const dailyNote = files.find(f => f.name.includes(today));
		if (dailyNote) return dailyNote;

		// Create or use a default tasks file
		const tasksFile = files.find(f => f.name === 'Tasks.md');
		if (tasksFile) return tasksFile;

		// Create new tasks file
		const newTasksFile = await this.app.vault.create('Tasks.md', '# Tasks\n\n');
		return newTasksFile;
	}
}