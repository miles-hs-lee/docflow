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
      { name: 'Workspace' },
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
      '/workspace': {
        get: {
          tags: ['Workspace'],
          summary: 'Identify this API key (workspace, label, scopes) — call this first',
          operationId: 'getWorkspaceInfo',
          responses: {
            '200': {
              description: 'Key context',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      workspace: {
                        type: 'object',
                        properties: { id: { type: 'string' }, name: { type: 'string' } }
                      },
                      keyLabel: { type: 'string', nullable: true },
                      scopes: { type: 'array', items: { type: 'string' } },
                      appUrl: { type: 'string' }
                    }
                  }
                }
              }
            },
            '401': errorResponse('Unauthorized')
          }
        }
      },
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
      '/files/{fileId}': {
        get: {
          tags: ['Files'],
          summary: 'Read one file (optionally with a 5-minute signed download URL)',
          operationId: 'getFile',
          parameters: [
            { name: 'fileId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeDownloadUrl', in: 'query', schema: { type: 'boolean' } }
          ],
          responses: {
            '200': {
              description: 'File (+ downloadUrl when requested)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { $ref: '#/components/schemas/File' },
                      downloadUrl: { type: 'string', nullable: true },
                      downloadUrlExpiresInSeconds: { type: 'integer', nullable: true }
                    }
                  }
                }
              }
            },
            '404': errorResponse('File not found')
          }
        },
        delete: {
          tags: ['Files'],
          summary: 'Delete a file (409 while active links reference it)',
          operationId: 'deleteFile',
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Deleted' },
            '404': errorResponse('File not found'),
            '409': errorResponse('Active links exist — trash them first')
          }
        }
      },
      '/links/{linkId}': {
        get: {
          tags: ['Links'],
          summary: 'Read one share link (full policy + viewer URL)',
          operationId: 'getLink',
          parameters: [{ name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Link',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { link: { $ref: '#/components/schemas/ShareLink' } } }
                }
              }
            },
            '404': errorResponse('Link not found')
          }
        },
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
          summary: 'Trash a share link (recoverable); ?permanent=true destroys a TRASHED link',
          operationId: 'deleteLink',
          parameters: [
            { name: 'linkId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'permanent',
              in: 'query',
              schema: { type: 'boolean', default: false },
              description: 'true = hard-delete. Only allowed when the link is already trashed (409 otherwise).'
            }
          ],
          responses: {
            '200': { description: 'Trashed / destroyed' },
            '404': errorResponse('Link not found'),
            '409': errorResponse('permanent=true on a live link — trash it first')
          }
        }
      },
      '/links/{linkId}/restore': {
        post: {
          tags: ['Links'],
          summary: 'Restore a trashed share link',
          operationId: 'restoreLink',
          parameters: [{ name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Restored link' },
            '404': errorResponse('Link not found'),
            '409': errorResponse('Link is not trashed')
          }
        }
      },
      '/links/{linkId}/preview': {
        get: {
          tags: ['Links'],
          summary: 'Mint a 15-minute owner-preview URL (gates bypassed, nothing counted)',
          operationId: 'previewLink',
          parameters: [{ name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Preview URL',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      expiresInSeconds: { type: 'integer' },
                      countsInAnalytics: { type: 'boolean' }
                    }
                  }
                }
              }
            },
            '404': errorResponse('Link not found')
          }
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
          summary: 'Summary metrics, denied breakdown, dwell engagement, and country split for one link',
          operationId: 'analyticsSummary',
          parameters: [{ name: 'linkId', in: 'query', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Summary + engagement + countries' },
            '404': errorResponse('Link not found')
          }
        }
      },
      '/analytics/visitors': {
        get: {
          tags: ['Analytics'],
          summary: 'Per-visitor rollup for one link (sessions, pages, dwell, downloads, NDA, country, UA)',
          operationId: 'analyticsVisitors',
          parameters: [
            { name: 'linkId', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }
          ],
          responses: { '200': { description: 'Visitors' }, '404': errorResponse('Link not found') }
        }
      },
      '/analytics/pages': {
        get: {
          tags: ['Analytics'],
          summary: 'Per-page heatmap for one link (views, distinct viewers, dwell). Collection links require fileId',
          operationId: 'analyticsPages',
          parameters: [
            { name: 'linkId', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'fileId', in: 'query', schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Pages + pageCount' },
            '400': errorResponse('fileId required for collection links'),
            '404': errorResponse('Link or file not found')
          }
        }
      },
      '/analytics/daily': {
        get: {
          tags: ['Analytics'],
          summary: 'Daily engagement series for one link (sessions + new viewers per day)',
          operationId: 'analyticsDaily',
          parameters: [
            { name: 'linkId', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
            { name: 'tz', in: 'query', schema: { type: 'string', default: 'UTC' }, description: 'IANA timezone' }
          ],
          responses: { '200': { description: 'Series' }, '404': errorResponse('Link not found') }
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
      '/collections/{collectionId}': {
        get: {
          tags: ['Collections'],
          summary: 'Read one data room: metadata, folders, contained files',
          operationId: 'getCollection',
          parameters: [{ name: 'collectionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Collection contents' }, '404': errorResponse('Collection not found') }
        },
        patch: {
          tags: ['Collections'],
          summary: 'Rename a data room / change its description',
          operationId: 'updateCollection',
          parameters: [{ name: 'collectionId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, description: { type: 'string', nullable: true } }
                }
              }
            }
          },
          responses: { '200': { description: 'Updated' }, '404': errorResponse('Collection not found') }
        },
        delete: {
          tags: ['Collections'],
          summary: 'Delete a data room (409 while active links reference it)',
          operationId: 'deleteCollection',
          parameters: [{ name: 'collectionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Deleted' },
            '404': errorResponse('Collection not found'),
            '409': errorResponse('Active links exist — trash them first')
          }
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
          responses: { '200': { description: 'Requests (each with its public /r URL)' } }
        },
        post: {
          tags: ['Requests'],
          summary: 'Create a public file-request inbox (receive files from outsiders)',
          operationId: 'createRequest',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    instructions: { type: 'string' },
                    requireEmail: { type: 'boolean', default: false },
                    expiresAt: { type: 'string', format: 'date-time' },
                    maxUploads: { type: 'integer', minimum: 1 }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'Created request (+ public URL)' } }
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
        },
        delete: {
          tags: ['Q&A'],
          summary: 'Delete one data-room question',
          operationId: 'deleteQuestion',
          parameters: [{ name: 'questionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' }, '404': errorResponse('Question not found') }
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
            page_count: { type: 'integer', nullable: true, description: 'Filled after the first view' },
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
            require_agreement: { type: 'boolean', description: 'Clickwrap NDA gate' },
            agreement_text: { type: 'string', nullable: true },
            viewer_group_id: { type: 'string', nullable: true },
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
            password: { type: 'string', minLength: 4 },
            allowDownload: { type: 'boolean' },
            oneTime: { type: 'boolean' },
            watermark: { type: 'boolean' },
            requireAgreement: { type: 'boolean', description: 'Clickwrap NDA gate before viewing' },
            agreementText: { type: 'string', maxLength: 5000 },
            viewerGroupId: { type: 'string', description: 'Collection links only — scope to a viewer group' }
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
            password: { type: 'string', minLength: 4 },
            clearPassword: { type: 'boolean' },
            allowDownload: { type: 'boolean' },
            oneTime: { type: 'boolean' },
            watermark: { type: 'boolean' },
            requireAgreement: { type: 'boolean' },
            agreementText: { type: 'string', nullable: true, maxLength: 5000 },
            viewerGroupId: { type: 'string', nullable: true, description: 'Collection links only; null = all folders' }
          }
        }
      }
    }
  };
}
