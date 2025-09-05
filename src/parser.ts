import { TFile, CachedMetadata } from 'obsidian';

export interface ObsidianTask {
	id?: string;
	text: string;
	completed: boolean;
	file: TFile;
	line: number;
	originalLine: string;
	dueDate?: Date;
	priority?: 'low' | 'normal' | 'high';
	tags?: string[];
	msToDoId?: string;
	lastModified?: Date;
}

export interface MSToDoTask {
	id: string;
	title: string;
	status: 'notStarted' | 'inProgress' | 'completed';
	importance: 'low' | 'normal' | 'high';
	dueDateTime?: {
		dateTime: string;
		timeZone: string;
	};
	createdDateTime: string;
	lastModifiedDateTime: string;
	body?: {
		content: string;
		contentType: string;
	};
	obsidianFile?: string;
	obsidianLine?: number;
}

export class TaskParser {
	private static readonly TASK_REGEX = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/;
	private static readonly DUE_DATE_REGEX = /📅\s*(\d{4}-\d{2}-\d{2})/;
	private static readonly PRIORITY_REGEX = /(🔺|⏫|🔻)/;
	private static readonly TAG_REGEX = /#([^\s#]+)/g;
	private static readonly MSTODO_ID_REGEX = /\[ms-todo:([^\]]+)\]/;
	private static readonly MSTODO_LINK_REGEX = /\[🔗 MS To Do\]\(ms-todo:([^)]+)\)/;
	
	// Tasks plugin patterns
	public static readonly COMPLETION_DATE_REGEX = /✅\s*(\d{4}-\d{2}-\d{2})/;
	public static readonly START_DATE_REGEX = /🛫\s*(\d{4}-\d{2}-\d{2})/;
	public static readonly SCHEDULED_DATE_REGEX = /⏰\s*(\d{4}-\d{2}-\d{2})/;
	public static readonly RECURRENCE_REGEX = /🔁\s*[^🔗\s]+/;
	public static readonly DONE_DATE_REGEX = /✅\s*\d{4}-\d{2}-\d{2}/;

	parseObsidianTasks(content: string, file: TFile): ObsidianTask[] {
		const tasks: ObsidianTask[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(TaskParser.TASK_REGEX);

			if (match) {
				const [, indent, checkboxState, taskText] = match;
				const completed = checkboxState.toLowerCase() === 'x';
				
				// Debug logging for task parsing
				console.log('Parsing task:', {
					line: i,
					originalLine: line,
					checkboxState: `"${checkboxState}"`,
					completed,
					taskText: taskText.substring(0, 50) + '...'
				});
				
				const task: ObsidianTask = {
					text: taskText.trim(),
					completed,
					file,
					line: i,
					originalLine: line,
					...this.parseTaskMetadata(taskText)
				};

				tasks.push(task);
			}
		}

		return tasks;
	}

	private parseTaskMetadata(taskText: string): Partial<ObsidianTask> {
		const metadata: Partial<ObsidianTask> = {};

		// Extract due date
		const dueDateMatch = taskText.match(TaskParser.DUE_DATE_REGEX);
		if (dueDateMatch) {
			metadata.dueDate = new Date(dueDateMatch[1]);
		}

		// Extract priority
		const priorityMatch = taskText.match(TaskParser.PRIORITY_REGEX);
		if (priorityMatch) {
			switch (priorityMatch[1]) {
				case '🔺':
				case '⏫':
					metadata.priority = 'high';
					break;
				case '🔻':
					metadata.priority = 'low';
					break;
				default:
					metadata.priority = 'normal';
			}
		}

		// Extract tags
		const tags = [];
		let tagMatch;
		while ((tagMatch = TaskParser.TAG_REGEX.exec(taskText)) !== null) {
			tags.push(tagMatch[1]);
		}
		if (tags.length > 0) {
			metadata.tags = tags;
		}

		// Extract MS To Do ID if present (support both old and new formats)
		const msToDoMatch = taskText.match(TaskParser.MSTODO_ID_REGEX);
		const msToDoLinkMatch = taskText.match(TaskParser.MSTODO_LINK_REGEX);
		
		if (msToDoLinkMatch) {
			metadata.msToDoId = msToDoLinkMatch[1];
		} else if (msToDoMatch) {
			metadata.msToDoId = msToDoMatch[1];
		}

		return metadata;
	}

	convertObsidianToMSToDoTask(obsidianTask: ObsidianTask): Partial<MSToDoTask> {
		const msTask: Partial<MSToDoTask> = {
			title: this.cleanTaskText(obsidianTask.text),
			status: obsidianTask.completed ? 'completed' : 'notStarted',
			importance: obsidianTask.priority || 'normal',
			obsidianFile: obsidianTask.file.path,
			obsidianLine: obsidianTask.line
		};

		if (obsidianTask.dueDate) {
			msTask.dueDateTime = {
				dateTime: obsidianTask.dueDate.toISOString(),
				timeZone: 'UTC'
			};
		}

		// Add tags and other metadata as task body
		if (obsidianTask.tags && obsidianTask.tags.length > 0) {
			msTask.body = {
				content: `Tags: ${obsidianTask.tags.map(tag => `#${tag}`).join(' ')}`,
				contentType: 'text'
			};
		}

		return msTask;
	}

	convertMSToDoToObsidianTask(msTask: MSToDoTask, file?: TFile): ObsidianTask {
		const obsidianTask: ObsidianTask = {
			text: this.formatTaskText(msTask),
			completed: msTask.status === 'completed',
			file: file as TFile,
			line: msTask.obsidianLine || -1,
			originalLine: '',
			msToDoId: msTask.id,
			lastModified: new Date(msTask.lastModifiedDateTime)
		};

		if (msTask.importance && msTask.importance !== 'normal') {
			obsidianTask.priority = msTask.importance;
		}

		if (msTask.dueDateTime) {
			obsidianTask.dueDate = new Date(msTask.dueDateTime.dateTime);
		}

		return obsidianTask;
	}

	cleanTaskText(text: string): string {
		// Remove ALL formatting and metadata to get core task text for comparison
		return text
			// Remove MS To Do links/IDs (both formats)
			.replace(TaskParser.MSTODO_ID_REGEX, '')
			.replace(TaskParser.MSTODO_LINK_REGEX, '')
			// Remove Obsidian task metadata
			.replace(TaskParser.DUE_DATE_REGEX, '')
			.replace(TaskParser.PRIORITY_REGEX, '')
			.replace(TaskParser.TAG_REGEX, '')
			// Remove Tasks plugin metadata
			.replace(TaskParser.COMPLETION_DATE_REGEX, '')
			.replace(TaskParser.START_DATE_REGEX, '')
			.replace(TaskParser.SCHEDULED_DATE_REGEX, '')
			.replace(TaskParser.RECURRENCE_REGEX, '')
			.replace(TaskParser.DONE_DATE_REGEX, '')
			// Clean up multiple spaces and trim
			.replace(/\s+/g, ' ')
			.trim();
	}

	// Get a stable identifier for a task that ignores formatting changes
	getTaskIdentity(text: string): string {
		return this.cleanTaskText(text).toLowerCase().replace(/[^\w\s]/g, '').trim();
	}

	// Merge MS To Do changes with existing Obsidian task, preserving Tasks plugin metadata
	mergeTaskWithExisting(obsidianTask: ObsidianTask, msTask: MSToDoTask): ObsidianTask {
		// Extract existing Tasks plugin metadata from original text
		const originalText = obsidianTask.text;
		
		// Extract metadata that should be preserved
		const completionDateMatch = originalText.match(TaskParser.COMPLETION_DATE_REGEX);
		const startDateMatch = originalText.match(TaskParser.START_DATE_REGEX);
		const scheduledDateMatch = originalText.match(TaskParser.SCHEDULED_DATE_REGEX);
		const recurrenceMatch = originalText.match(TaskParser.RECURRENCE_REGEX);
		
		// Start with the core task title from MS To Do
		let mergedText = msTask.title;
		
		// Add back preserved metadata
		if (completionDateMatch && msTask.status === 'completed') {
			mergedText += ` ${completionDateMatch[0]}`;
		}
		if (startDateMatch) {
			mergedText += ` ${startDateMatch[0]}`;
		}
		if (scheduledDateMatch) {
			mergedText += ` ${scheduledDateMatch[0]}`;
		}
		if (recurrenceMatch) {
			mergedText += ` ${recurrenceMatch[0]}`;
		}
		
		// Add MS To Do metadata
		if (msTask.importance === 'high') {
			mergedText += ' 🔺';
		} else if (msTask.importance === 'low') {
			mergedText += ' 🔻';
		}
		
		if (msTask.dueDateTime) {
			const dueDate = new Date(msTask.dueDateTime.dateTime);
			mergedText += ` 📅 ${dueDate.toISOString().split('T')[0]}`;
		}
		
		// Add MS To Do link (preserve existing if present)
		const msToDoLinkMatch = originalText.match(TaskParser.MSTODO_LINK_REGEX);
		const msToDoIdMatch = originalText.match(TaskParser.MSTODO_ID_REGEX);
		
		if (msToDoLinkMatch) {
			mergedText += ` ${msToDoLinkMatch[0]}`;
		} else if (msToDoIdMatch) {
			mergedText += ` ${msToDoIdMatch[0]}`;
		} else {
			mergedText += ` [🔗 MS To Do](ms-todo:${msTask.id})`;
		}
		
		return {
			...obsidianTask,
			text: mergedText,
			completed: msTask.status === 'completed',
			priority: msTask.importance === 'normal' ? undefined : msTask.importance as 'high' | 'low',
			dueDate: msTask.dueDateTime ? new Date(msTask.dueDateTime.dateTime) : undefined,
			msToDoId: msTask.id,
			lastModified: new Date(msTask.lastModifiedDateTime)
		};
	}

	private formatTaskText(msTask: MSToDoTask): string {
		let text = msTask.title;

		// Add priority indicator
		if (msTask.importance === 'high') {
			text += ' 🔺';
		} else if (msTask.importance === 'low') {
			text += ' 🔻';
		}

		// Add due date
		if (msTask.dueDateTime) {
			const dueDate = new Date(msTask.dueDateTime.dateTime);
			text += ` 📅 ${dueDate.toISOString().split('T')[0]}`;
		}

		// Add MS To Do link for tracking (clean format)
		text += ` [🔗 MS To Do](ms-todo:${msTask.id})`;

		return text;
	}

	updateTaskInContent(content: string, task: ObsidianTask, newTask: ObsidianTask): string {
		const lines = content.split('\n');
		
		if (task.line >= 0 && task.line < lines.length) {
			const indent = lines[task.line].match(/^(\s*)/)?.[1] || '';
			const checkbox = newTask.completed ? '[x]' : '[ ]';
			lines[task.line] = `${indent}- ${checkbox} ${newTask.text}`;
		}

		return lines.join('\n');
	}

	addTaskToContent(content: string, task: ObsidianTask, position: 'top' | 'bottom' = 'bottom'): string {
		const checkbox = task.completed ? '[x]' : '[ ]';
		const taskLine = `- ${checkbox} ${task.text}`;

		if (position === 'top') {
			return taskLine + '\n' + content;
		} else {
			return content + '\n' + taskLine;
		}
	}

	removeTaskFromContent(content: string, task: ObsidianTask): string {
		const lines = content.split('\n');
		
		if (task.line >= 0 && task.line < lines.length) {
			lines.splice(task.line, 1);
		}

		return lines.join('\n');
	}
}