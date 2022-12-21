import { IHookFunctions, IWebhookFunctions } from 'n8n-core';

import {
	IDataObject,
	ILoadOptionsFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

import { baserowApiRequest, toOptions } from './GenericFunctions';
import { LoadedResource } from './types';

export class BaserowTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Baserow Trigger',
		name: 'baserowTrigger',
		icon: 'file:baserow.svg',
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when Baserow events occur',
		defaults: {
			name: 'Baserow Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'baserowApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Database Name or ID',
				name: 'databaseId',
				type: 'options',
				default: '',
				required: true,
				description:
					'Database to operate on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code-examples/expressions/">expression</a>.',
				typeOptions: {
					loadOptionsMethod: 'getDatabaseIds',
				},
			},
			{
				displayName: 'Table Name or ID',
				name: 'tableId',
				type: 'options',
				default: '',
				required: true,
				description:
					'Table to operate on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code-examples/expressions/">expression</a>.',
				typeOptions: {
					loadOptionsDependsOn: ['databaseId'],
					loadOptionsMethod: 'getTableIds',
				},
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{
						name: 'Rows Created',
						value: 'rows.created',
					},
					{
						name: 'Rows Deleted',
						value: 'rows.deleted',
					},
					{
						name: 'Rows Updated',
						value: 'rows.updated',
					},
				],
				required: true,
				default: [],
				description: 'The events to listen to',
			},
		],
	};

	methods = {
		loadOptions: {
			async getDatabaseIds(this: ILoadOptionsFunctions) {
				const endpoint = '/api/applications/';
				const databases = (await baserowApiRequest.call(
					this,
					'GET',
					endpoint,
				)) as LoadedResource[];
				return toOptions(databases);
			},

			async getTableIds(this: ILoadOptionsFunctions) {
				const databaseId = this.getNodeParameter('databaseId', 0) as string;
				const endpoint = `/api/database/tables/database/${databaseId}/`;
				const tables = (await baserowApiRequest.call(
					this,
					'GET',
					endpoint,
				)) as LoadedResource[];
				return toOptions(tables);
			},
		},
	};

	// @ts-ignore (because of request)
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');

				if (webhookData.webhookId === undefined) {
					return false;
				}
				try {
					await baserowApiRequest.call(this, 'GET', `/api/database/webhooks/${webhookData.webhookId}/`);
				} catch (error) {
					if (error.response.status === 404) {
						delete webhookData.webhookId;
						delete webhookData.webhookEvents;
						return false;
					}
					throw error;
				}
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;

				if (webhookUrl.includes('//localhost')) {
					throw new NodeOperationError(
						this.getNode(),
						'The Webhook can not work on "localhost". Please, either setup n8n on a custom domain or start with "--tunnel"!',
					);
				}

				const tableId = this.getNodeParameter('tableId') as string;
				const events = this.getNodeParameter('events', []);
				const endpoint = `/api/database/webhooks/table/${tableId}/`;

				const body = {
					"url": webhookUrl,
					"include_all_events": false,
					events,
					"request_method": "POST",
					"name": `${this.getWorkflow().name}`,
					"use_user_field_names": true,
				};

				const webhookData = this.getWorkflowStaticData('node');

				let responseData;
				try {
					responseData = await baserowApiRequest.call(this, 'POST', endpoint, body);
				} catch (error) {
					throw error;
				}

				if (responseData.id === undefined || responseData.active !== true) {
					throw new NodeApiError(this.getNode(), responseData, {
						message: 'Baserow webhook creation response did not contain the expected data.',
					});
				}

				webhookData.webhookId = responseData.id as string;
				webhookData.webhookEvents = responseData.events as string[];

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');

				if (webhookData.webhookId !== undefined) {
					const endpoint = `/api/database/webhooks/${webhookData.webhookId}/`;
					const body = {};
					try {
						await baserowApiRequest.call(this, 'DELETE', endpoint, body);
					} catch (error) {
						if (error.response.status !== 404) {
							return false;
						}
					}
					delete webhookData.webhookId;
					delete webhookData.webhookEvents;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();
		if (bodyData.hook_id !== undefined && bodyData.action === undefined) {
			return {
				webhookResponse: 'OK',
			};
		}

		const returnData: IDataObject[] = [];

		returnData.push({
			body: bodyData,
		});

		return {
			workflowData: [this.helpers.returnJsonArray(bodyData)],
		};
	}
}
