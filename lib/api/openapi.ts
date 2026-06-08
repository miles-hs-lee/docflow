import { publicEnv } from '@/lib/env-public';
import { SUBSCRIBABLE_EVENTS } from '@/lib/api/operations';

// Hand-authored OpenAPI 3.0 document for the DocFlow REST API. Served at
// /api/v1/openapi.json and rendered by /api/v1/docs. The same operations back
// the MCP gateway (/api/mcp); this is the traditional REST surface for Zapier /
// Make / scripts. Keep paths in sync with app/api/v1/* + lib/api/operations.ts.

const limitParam = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 200 }
};

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' }
    }
  }
});

export function buildOpenApiSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'DocFlow API',
      version: '1.0.0',
      description:
        'REST API for DocFlow — files, share links, data rooms, analytics, and webhook automations. ' +
        'Authenticate with an API key (Bearer token) created in the dashboard; every request is scoped ' +
        'to that key’s workspace. The same operations are also available over MCP at /api/mcp.'
    },
    servers: [{ url: `${publicEnv.appUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Files' },
      { name: 'Links' },
      { name: 'Collections' },
      { name: 'Analytics' },
      { name: 'Automations' },
      { name: 'Requests' },
      { name: 'Q&A' },
      { name: 'Contacts' }
    ],
    paths: {
      '/files': {
        get: {
          tags: ['Files'],
          summary: 'List files',
          operationId: 'listFiles',
          parameters: [limitParam],
          responses: {
            '200': {
              description: 'Files',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { files: { type: 'array', items: { $ref: '#/components/schemas/File' } } }
                  }
                }
              }
            },
            '401': errorResponse('Unauthorized'),
            '403': errorResponse('Missing files:read scope')
          }
        },
        post: {
          tags: ['Files'],
          summary: 'Upload a PDF (base64)',
          operationId: 'uploadFile',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['filename', 'contentBase64'],
                  properties: {
                    filename: { type: 'string', example: 'pitch.pdf' },
                    contentBase64: { type: 'string', description: 'Base64 PDF data (raw or data URI)' },
                    mimeType: { type: 'string', default: 'application/pdf' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Created file',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { $ref: '#/components/schemas/File' },
                      dashboardUrl: { type: 'string' }
                    }
                  }
                }
              }
            },
            '400': errorResponse('Invalid PDF'),
            '403': errorResponse('Missing files:write scope'),
            '413': errorResponse('File too large')
          }
        }
      },
      '/links': {
        get: {
          tags: ['Links'],
          summary: 'List share links',
          operationId: 'listLinks',
          parameters: [
            { name: 'targetType', in: 'query', schema: { type: 'string', enum: ['file', 'collection'] } },
            { name: 'targetId', in: 'query', schema: { type: 'string' } },
            { name: 'includeDeleted', in: 'query', schema: { type: 'boolean' } },
            limitParam
          ],
          responses: {
            '200': {
              description: 'Links',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { links: { type: 'array', items: { $ref: '#/components/schemas/ShareLink' } } }
                  }
                }
              }
            },
            '403': errorResponse('Missing links:read scope')
          }
        },
        post: {
          tags: ['Links'],
          summary: 'Create a share link',
          operationId: 'createLink',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LinkCreate' } } }
          },
          responses: {
            '200': {
              description: 'Created link',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { link: { $ref: '#/components/schemas/ShareLink' } } }
                }
              }
            },
            '400': errorResponse('Invalid params'),
            '403': errorResponse('Missing links:write scope'),
            '404': errorResponse('Target file/collection not found')
          }
        }
      },
      '/links/{linkId}': {
        patch: {
          tags: ['Links'],
          summary: 'Update a share link’s policy',
          operationId: 'updateLink',
          parameters: [{ name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: false,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LinkUpdate' } } }
          },
          responses: {
            '200': {
              description: 'Updated link',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { link: { $ref: '#/components/schemas/ShareLink' } } }
                }
              }
            },
            '404': errorResponse('Link not found')
          }
        },
        delete: {
          tags: ['Links'],
          summary: 'Move a share link to the trash',
          operationId: 'deleteLink',
          parameters: [{ name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Trashed' }, '404': errorResponse('Link not found') }
        }
      },
      '/collections': {
        get: {
          tags: ['Collections'],
          summary: 'List data rooms (collections)',
          operationId: 'listCollections',
          parameters: [limitParam],
          responses: {
            '200': {
              description: 'Collections',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      collections: { type: 'array', items: { $ref: '#/components/schemas/Collection' } }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          tags: ['Collections'],
          summary: 'Create an empty data room',
          operationId: 'createCollection',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' }, description: { type: 'string' } }
                }
              }
            }
          },
          responses: { '200': { description: 'Created collection' } }
        }
      },
      '/analytics/summary': {
        get: {
          tags: ['Analytics'],
          summary: 'Summary metrics + denied breakdown for one link',
          operationId: 'analyticsSummary',
          parameters: [{ name: 'linkId', in: 'query', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Summary' },
            '404': errorResponse('Link not found')
          }
        }
      },
      '/analytics/events': {
        get: {
          tags: ['Analytics'],
          summary: 'Link events (cursor pagination)',
          operationId: 'analyticsEvents',
          parameters: [
            { name: 'linkId', in: 'query', schema: { type: 'string' } },
            { name: 'afterId', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } }
          ],
          responses: { '200': { description: 'Events + nextCursor' } }
        }
      },
      '/automations': {
        get: {
          tags: ['Automations'],
          summary: 'List webhook subscriptions',
          operationId: 'listAutomations',
          parameters: [{ name: 'includeInactive', in: 'query', schema: { type: 'boolean' } }],
          responses: { '200': { description: 'Subscriptions' } }
        },
        post: {
          tags: ['Automations'],
          summary: 'Create a webhook subscription',
          operationId: 'subscribeAutomation',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'webhookUrl'],
                  properties: {
                    name: { type: 'string' },
                    webhookUrl: { type: 'string', format: 'uri' },
                    signingSecret: { type: 'string', description: 'Optional HMAC signing secret' },
                    eventTypes: {
                      type: 'array',
                      items: { type: 'string', enum: [...SUBSCRIBABLE_EVENTS] }
                    },
                    isActive: { type: 'boolean', default: true }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Created subscription' },
            '409': errorResponse('Dispatcher not enabled on the server')
          }
        }
      },
      '/automations/{id}': {
        delete: {
          tags: ['Automations'],
          summary: 'Delete a webhook subscription',
          operationId: 'unsubscribeAutomation',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' } }
        }
      },
      '/collections/{collectionId}/files': {
        post: {
          tags: ['Collections'],
          summary: 'Add existing files to a data room',
          operationId: 'addFilesToCollection',
          parameters: [{ name: 'collectionId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['fileIds'],
                  properties: { fileIds: { type: 'array', items: { type: 'string' } } }
                }
              }
            }
          },
          responses: { '200': { description: 'Added' }, '404': errorResponse('Collection or file not found') }
        }
      },
      '/collections/{collectionId}/files/{fileId}': {
        delete: {
          tags: ['Collections'],
          summary: 'Remove (unlink) one file from a data room',
          operationId: 'removeFileFromCollection',
          parameters: [
            { name: 'collectionId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Removed' } }
        }
      },
      '/requests': {
        get: {
          tags: ['Requests'],
          summary: 'List file-request inboxes',
          operationId: 'listRequests',
          parameters: [limitParam],
          responses: { '200': { description: 'Requests' } }
        }
      },
      '/requests/{requestId}/uploads': {
        get: {
          tags: ['Requests'],
          summary: 'List uploads received by a file request',
          operationId: 'listRequestUploads',
          parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Uploads' }, '404': errorResponse('Request not found') }
        }
      },
      '/questions': {
        get: {
          tags: ['Q&A'],
          summary: 'List data-room questions',
          operationId: 'listQuestions',
          parameters: [{ name: 'collectionId', in: 'query', schema: { type: 'string' } }, limitParam],
          responses: { '200': { description: 'Questions' } }
        }
      },
      '/questions/{questionId}': {
        patch: {
          tags: ['Q&A'],
          summary: 'Answer one data-room question',
          operationId: 'answerQuestion',
          parameters: [{ name: 'questionId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } }
              }
            }
          },
          responses: { '200': { description: 'Answered' }, '404': errorResponse('Question not found') }
        }
      },
      '/contacts': {
        get: {
          tags: ['Contacts'],
          summary: 'List captured viewer contacts',
          operationId: 'listContacts',
          parameters: [limitParam],
          responses: { '200': { description: 'Contacts' } }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'DocFlow API key' }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } }
            }
          }
        },
        File: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            original_name: { type: 'string' },
            size_bytes: { type: 'integer' },
            mime_type: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Collection: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            file_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        ShareLink: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            token: { type: 'string' },
            url: { type: 'string' },
            is_active: { type: 'boolean' },
            require_email: { type: 'boolean' },
            allow_download: { type: 'boolean' },
            one_time: { type: 'boolean' },
            watermark: { type: 'boolean' },
            has_password: { type: 'boolean' },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
            max_views: { type: 'integer', nullable: true }
          }
        },
        LinkCreate: {
          type: 'object',
          required: ['targetType', 'targetId', 'label'],
          properties: {
            targetType: { type: 'string', enum: ['file', 'collection'] },
            targetId: { type: 'string' },
            label: { type: 'string' },
            isActive: { type: 'boolean' },
            expiresAt: { type: 'string', format: 'date-time' },
            maxViews: { type: 'integer', minimum: 1 },
            requireEmail: { type: 'boolean' },
            allowedDomains: { type: 'array', items: { type: 'string' } },
            password: { type: 'string' },
            allowDownload: { type: 'boolean' },
            oneTime: { type: 'boolean' },
            watermark: { type: 'boolean' }
          }
        },
        LinkUpdate: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            isActive: { type: 'boolean' },
            expiresAt: { type: 'string', nullable: true },
            maxViews: { type: 'integer', nullable: true },
            requireEmail: { type: 'boolean' },
            allowedDomains: { type: 'array', items: { type: 'string' } },
            password: { type: 'string' },
            clearPassword: { type: 'boolean' },
            allowDownload: { type: 'boolean' },
            oneTime: { type: 'boolean' },
            watermark: { type: 'boolean' }
          }
        }
      }
    }
  };
}
