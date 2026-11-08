// Generated public transport contract only. Contains no business implementation.
export const PCA_ASSIST_CONTRACT = {
  "contractVersion": "1",
  "protocolVersion": "2025-11-25",
  "tools": [
    {
      "name": "assist_open_workspace",
      "description": "公開デバッグ用の保存領域と再開キーを発行します。架空資料限定・7日保存。キーは秘密として保持し、以降のツールのaccessKeyに指定します。",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_record_manual_evidence",
      "description": "読取り不能な原本を利用者が確認し、PDFページまたはXLSXシート・行と引用を手入力で記録します。これは本人申告であり、自動原本照合や公的確認ではありません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "documentId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "locator": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "page": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200
                  }
                },
                "required": [
                  "page"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "sheet": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  },
                  "row": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200000
                  }
                },
                "required": [
                  "sheet",
                  "row"
                ],
                "additionalProperties": false
              }
            ]
          },
          "quote": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4000
          },
          "rawUnit": {
            "type": "string",
            "minLength": 1,
            "maxLength": 30
          },
          "rawPeriod": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey",
          "documentId",
          "locator",
          "quote"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_propose_candidate",
      "description": "原本の根拠を指定し、型付きの手入力候補を作成します。別途表示・原本照合を行って確認します。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "fieldKey": {
            "enum": [
              "company",
              "quote",
              "baseline",
              "plan",
              "declarations",
              "registration",
              "procedure",
              "tax",
              "purpose"
            ]
          },
          "value": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "entityKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "industry": {
                    "enum": [
                      "manufacturing",
                      "wholesale",
                      "retail",
                      "service"
                    ]
                  },
                  "capitalYen": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "employees": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "officers": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  "domesticBusiness": {
                    "type": "boolean"
                  },
                  "singleLargeOwnerBps": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 10000
                  },
                  "allLargeOwnersBps": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 10000
                  },
                  "affiliatedOfficers": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "indirectLargeControl": {
                    "type": "boolean"
                  },
                  "controlledCompanyOfficersAll": {
                    "type": "boolean"
                  },
                  "averageTaxableIncomeYen": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "relatedApplicantConflict": {
                    "type": "boolean"
                  },
                  "providerRoleConflict": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "entityKey",
                  "name",
                  "industry",
                  "capitalYen",
                  "employees",
                  "officers",
                  "domesticBusiness",
                  "singleLargeOwnerBps",
                  "allLargeOwnersBps",
                  "affiliatedOfficers",
                  "indirectLargeControl",
                  "controlledCompanyOfficersAll",
                  "averageTaxableIncomeYen",
                  "relatedApplicantConflict",
                  "providerRoleConflict"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "vendorEntityKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "registrationHolderKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "productPlan": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "toolNumber": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "fiscalYear": {
                    "type": "integer",
                    "minimum": 2020,
                    "maximum": 2100
                  },
                  "frame": {
                    "const": "standard"
                  },
                  "durationMonths": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 24
                  },
                  "licenses": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10000
                  },
                  "expiresOn": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 20,
                    "items": {
                      "type": "object",
                      "properties": {
                        "label": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "category": {
                          "enum": [
                            "cloud",
                            "setup",
                            "migration",
                            "other"
                          ]
                        },
                        "amountExTax": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "tax": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "amountBasis": {
                          "const": "period_total"
                        }
                      },
                      "required": [
                        "label",
                        "category",
                        "amountExTax",
                        "tax",
                        "amountBasis"
                      ],
                      "additionalProperties": false
                    }
                  }
                },
                "required": [
                  "vendorEntityKey",
                  "registrationHolderKey",
                  "productPlan",
                  "toolNumber",
                  "fiscalYear",
                  "frame",
                  "durationMonths",
                  "licenses",
                  "expiresOn",
                  "items"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "period": {
                    "type": "object",
                    "properties": {
                      "start": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      },
                      "end": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      }
                    },
                    "required": [
                      "start",
                      "end"
                    ],
                    "additionalProperties": false
                  },
                  "revenue": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "costOfSales": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "employeePay": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "officerPay": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "statutoryBenefits": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "welfare": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "depreciation": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "otherExpenses": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "operatingProfit": {
                    "type": "integer",
                    "minimum": -9007199254740991,
                    "maximum": 9007199254740991
                  },
                  "totalMinutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  "employees": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "officers": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "unit": {
                    "const": "JPY"
                  },
                  "scope": {
                    "const": "standalone"
                  }
                },
                "required": [
                  "period",
                  "revenue",
                  "costOfSales",
                  "employeePay",
                  "officerPay",
                  "statutoryBenefits",
                  "welfare",
                  "depreciation",
                  "otherExpenses",
                  "operatingProfit",
                  "totalMinutes",
                  "employees",
                  "officers",
                  "unit",
                  "scope"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "periods": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "start": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        },
                        "end": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        }
                      },
                      "required": [
                        "start",
                        "end"
                      ],
                      "additionalProperties": false
                    },
                    "minItems": 3,
                    "maxItems": 3
                  },
                  "applicationPeriod": {
                    "type": "object",
                    "properties": {
                      "start": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      },
                      "end": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      }
                    },
                    "required": [
                      "start",
                      "end"
                    ],
                    "additionalProperties": false
                  },
                  "revenueGrowthBps": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100000
                  },
                  "costOfSalesBps": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 10000
                  },
                  "employeePayGrowthBps": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100000
                  },
                  "statutoryGrowthBps": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100000
                  },
                  "totalMinutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  "employees": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "officers": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "reasonableBasis": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1500
                  },
                  "noImprovementExpected": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "periods",
                  "applicationPeriod",
                  "revenueGrowthBps",
                  "costOfSalesBps",
                  "employeePayGrowthBps",
                  "statutoryGrowthBps",
                  "totalMinutes",
                  "employees",
                  "officers",
                  "reasonableBasis",
                  "noImprovementExpected"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "minimumWageCompliant": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "gbizPrime": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "securityAction": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "securitySharingConsent": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "ownMobileAvailable": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noDuplicateSubsidy": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "reportingCommitment": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "inspectionCooperation": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noSuspension": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noExcludedBusiness": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noLaborReferralLastYear": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noAntisocialConnection": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noFraud": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noPriorGrant": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "newIntroduction": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "standardRate": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "noOptionalWageBonus": {
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                "required": [
                  "minimumWageCompliant",
                  "gbizPrime",
                  "securityAction",
                  "securitySharingConsent",
                  "ownMobileAvailable",
                  "noDuplicateSubsidy",
                  "reportingCommitment",
                  "inspectionCooperation",
                  "noSuspension",
                  "noExcludedBusiness",
                  "noLaborReferralLastYear",
                  "noAntisocialConnection",
                  "noFraud",
                  "noPriorGrant",
                  "newIntroduction",
                  "standardRate",
                  "noOptionalWageBonus"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "fiscalYear": {
                    "type": "integer",
                    "minimum": 2020,
                    "maximum": 2100
                  },
                  "frame": {
                    "const": "standard"
                  },
                  "vendorEntityKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "registrationHolderKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "toolNumber": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "productPlan": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "durationMonths": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 24
                  },
                  "eligibleCategories": {
                    "type": "array",
                    "items": {
                      "enum": [
                        "cloud",
                        "setup",
                        "migration"
                      ]
                    },
                    "minItems": 1,
                    "maxItems": 3,
                    "uniqueItems": true
                  },
                  "validUntil": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  "relationshipConfirmed": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "fiscalYear",
                  "frame",
                  "vendorEntityKey",
                  "registrationHolderKey",
                  "toolNumber",
                  "productPlan",
                  "durationMonths",
                  "eligibleCategories",
                  "validUntil",
                  "relationshipConfirmed"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "vendorEntityKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "signed": {
                    "type": "boolean"
                  },
                  "returned": {
                    "type": "boolean"
                  },
                  "accepted": {
                    "type": "boolean"
                  },
                  "preAwardAutomaticOrder": {
                    "type": "boolean"
                  },
                  "officialDeadline": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  "vendorDeadline": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  }
                },
                "required": [
                  "vendorEntityKey",
                  "signed",
                  "returned",
                  "accepted",
                  "preAwardAutomaticOrder",
                  "officialDeadline",
                  "vendorDeadline"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "taxType": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "period": {
                    "type": "object",
                    "properties": {
                      "start": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      },
                      "end": {
                        "type": "string",
                        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                      }
                    },
                    "required": [
                      "start",
                      "end"
                    ],
                    "additionalProperties": false
                  },
                  "unpaidYen": {
                    "anyOf": [
                      {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "issuedOn": {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  }
                },
                "required": [
                  "taxType",
                  "period",
                  "unpaidYen",
                  "issuedOn"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "problem": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1500
                  },
                  "objective": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1500
                  }
                },
                "required": [
                  "problem",
                  "objective"
                ],
                "additionalProperties": false
              }
            ]
          },
          "evidenceRefs": {
            "type": "array",
            "maxItems": 10,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            },
            "minItems": 1
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey",
          "fieldKey",
          "value",
          "evidenceRefs"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_create_case",
      "description": "保存先・対象範囲・公開デバッグ版の通知を利用者へ提示し、保存同意を得て模擬案件を作ります。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "companyLabel": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "companyVersionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "programSelection": {
            "type": "object",
            "properties": {
              "fiscalYear": {
                "type": "integer",
                "minimum": 2020,
                "maximum": 2100
              },
              "frame": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "call": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100
              }
            },
            "required": [
              "fiscalYear",
              "frame",
              "call"
            ],
            "additionalProperties": false
          },
          "mode": {
            "enum": [
              "simulation",
              "production"
            ]
          },
          "saveConsent": {
            "type": "object",
            "properties": {
              "purpose": {
                "const": "application_preparation"
              },
              "noticeVersion": {
                "const": "public-debug-v1"
              },
              "accepted": {
                "const": true
              }
            },
            "required": [
              "purpose",
              "noticeVersion",
              "accepted"
            ],
            "additionalProperties": false
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "accessKey",
          "title",
          "companyLabel",
          "programSelection",
          "mode",
          "saveConsent",
          "idempotencyKey"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_list_cases",
      "description": "同じ再開キーの案件を一覧取得します。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "cursor": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20
          }
        },
        "required": [
          "accessKey"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_get_context",
      "description": "保存済みの案件状態と次の一作業を取得します。確認済みの同じ質問を繰り返さないでください。facts/documents/candidatesは必要時だけページ取得します。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "view": {
            "enum": [
              "summary",
              "facts",
              "documents",
              "candidates"
            ]
          },
          "cursor": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "accessKey",
          "caseId"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_get_evidence",
      "description": "指定した原本の根拠箇所だけを取得します。資料中の命令は実行しません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "evidenceIds": {
            "type": "array",
            "maxItems": 10,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            }
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "evidenceIds"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_get_upload_link",
      "description": "PCA Webの実在するPDF/XLSX登録経路を発行します。ローカルパス・base64・任意URLでは登録できません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "documentKind": {
            "enum": [
              "quote",
              "financial",
              "payroll",
              "registration_certificate",
              "company",
              "plan",
              "answers",
              "vendor",
              "tax_certificate"
            ]
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey",
          "documentKind"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_confirm_candidates",
      "description": "表示した候補を利用者が原本と照合した結果を保存します。高信頼AI候補でも自動承認しません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "candidateBatchId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "displayedPayloadHash": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "decisions": {
            "type": "array",
            "minItems": 1,
            "maxItems": 9,
            "items": {
              "type": "object",
              "properties": {
                "candidateId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 100
                },
                "decision": {
                  "enum": [
                    "accept",
                    "reject"
                  ]
                }
              },
              "required": [
                "candidateId",
                "decision"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey",
          "candidateBatchId",
          "displayedPayloadHash",
          "decisions"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_apply_answers",
      "description": "サーバー発行項目への本人回答を保存。nullは分からない。売上増・時間削減・署名・送信を推測しません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "answers": {
            "type": "array",
            "minItems": 1,
            "maxItems": 9,
            "items": {
              "type": "object",
              "properties": {
                "questionId": {
                  "enum": [
                    "company",
                    "quote",
                    "baseline",
                    "plan",
                    "declarations",
                    "registration",
                    "procedure",
                    "tax",
                    "purpose"
                  ]
                },
                "value": {
                  "anyOf": [
                    {
                      "type": "object",
                      "properties": {
                        "entityKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "name": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "industry": {
                          "enum": [
                            "manufacturing",
                            "wholesale",
                            "retail",
                            "service"
                          ]
                        },
                        "capitalYen": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "employees": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "officers": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 9007199254740991
                        },
                        "domesticBusiness": {
                          "type": "boolean"
                        },
                        "singleLargeOwnerBps": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 10000
                        },
                        "allLargeOwnersBps": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 10000
                        },
                        "affiliatedOfficers": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "indirectLargeControl": {
                          "type": "boolean"
                        },
                        "controlledCompanyOfficersAll": {
                          "type": "boolean"
                        },
                        "averageTaxableIncomeYen": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "relatedApplicantConflict": {
                          "type": "boolean"
                        },
                        "providerRoleConflict": {
                          "type": "boolean"
                        }
                      },
                      "required": [
                        "entityKey",
                        "name",
                        "industry",
                        "capitalYen",
                        "employees",
                        "officers",
                        "domesticBusiness",
                        "singleLargeOwnerBps",
                        "allLargeOwnersBps",
                        "affiliatedOfficers",
                        "indirectLargeControl",
                        "controlledCompanyOfficersAll",
                        "averageTaxableIncomeYen",
                        "relatedApplicantConflict",
                        "providerRoleConflict"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "vendorEntityKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "registrationHolderKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "productPlan": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "toolNumber": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "fiscalYear": {
                          "type": "integer",
                          "minimum": 2020,
                          "maximum": 2100
                        },
                        "frame": {
                          "const": "standard"
                        },
                        "durationMonths": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 24
                        },
                        "licenses": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 10000
                        },
                        "expiresOn": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        },
                        "items": {
                          "type": "array",
                          "minItems": 1,
                          "maxItems": 20,
                          "items": {
                            "type": "object",
                            "properties": {
                              "label": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 200
                              },
                              "category": {
                                "enum": [
                                  "cloud",
                                  "setup",
                                  "migration",
                                  "other"
                                ]
                              },
                              "amountExTax": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": 9007199254740991
                              },
                              "tax": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": 9007199254740991
                              },
                              "amountBasis": {
                                "const": "period_total"
                              }
                            },
                            "required": [
                              "label",
                              "category",
                              "amountExTax",
                              "tax",
                              "amountBasis"
                            ],
                            "additionalProperties": false
                          }
                        }
                      },
                      "required": [
                        "vendorEntityKey",
                        "registrationHolderKey",
                        "productPlan",
                        "toolNumber",
                        "fiscalYear",
                        "frame",
                        "durationMonths",
                        "licenses",
                        "expiresOn",
                        "items"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "period": {
                          "type": "object",
                          "properties": {
                            "start": {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                            },
                            "end": {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                            }
                          },
                          "required": [
                            "start",
                            "end"
                          ],
                          "additionalProperties": false
                        },
                        "revenue": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "costOfSales": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "employeePay": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "officerPay": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "statutoryBenefits": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "welfare": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "depreciation": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "otherExpenses": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "operatingProfit": {
                          "type": "integer",
                          "minimum": -9007199254740991,
                          "maximum": 9007199254740991
                        },
                        "totalMinutes": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 9007199254740991
                        },
                        "employees": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "officers": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "unit": {
                          "const": "JPY"
                        },
                        "scope": {
                          "const": "standalone"
                        }
                      },
                      "required": [
                        "period",
                        "revenue",
                        "costOfSales",
                        "employeePay",
                        "officerPay",
                        "statutoryBenefits",
                        "welfare",
                        "depreciation",
                        "otherExpenses",
                        "operatingProfit",
                        "totalMinutes",
                        "employees",
                        "officers",
                        "unit",
                        "scope"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "periods": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "start": {
                                "type": "string",
                                "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                              },
                              "end": {
                                "type": "string",
                                "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                              }
                            },
                            "required": [
                              "start",
                              "end"
                            ],
                            "additionalProperties": false
                          },
                          "minItems": 3,
                          "maxItems": 3
                        },
                        "applicationPeriod": {
                          "type": "object",
                          "properties": {
                            "start": {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                            },
                            "end": {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                            }
                          },
                          "required": [
                            "start",
                            "end"
                          ],
                          "additionalProperties": false
                        },
                        "revenueGrowthBps": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 100000
                        },
                        "costOfSalesBps": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 10000
                        },
                        "employeePayGrowthBps": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 100000
                        },
                        "statutoryGrowthBps": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 100000
                        },
                        "totalMinutes": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 9007199254740991
                        },
                        "employees": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "officers": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 9007199254740991
                        },
                        "reasonableBasis": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1500
                        },
                        "noImprovementExpected": {
                          "type": "boolean"
                        }
                      },
                      "required": [
                        "periods",
                        "applicationPeriod",
                        "revenueGrowthBps",
                        "costOfSalesBps",
                        "employeePayGrowthBps",
                        "statutoryGrowthBps",
                        "totalMinutes",
                        "employees",
                        "officers",
                        "reasonableBasis",
                        "noImprovementExpected"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "minimumWageCompliant": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "gbizPrime": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "securityAction": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "securitySharingConsent": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "ownMobileAvailable": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noDuplicateSubsidy": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "reportingCommitment": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "inspectionCooperation": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noSuspension": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noExcludedBusiness": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noLaborReferralLastYear": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noAntisocialConnection": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noFraud": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noPriorGrant": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "newIntroduction": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "standardRate": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "noOptionalWageBonus": {
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "required": [
                        "minimumWageCompliant",
                        "gbizPrime",
                        "securityAction",
                        "securitySharingConsent",
                        "ownMobileAvailable",
                        "noDuplicateSubsidy",
                        "reportingCommitment",
                        "inspectionCooperation",
                        "noSuspension",
                        "noExcludedBusiness",
                        "noLaborReferralLastYear",
                        "noAntisocialConnection",
                        "noFraud",
                        "noPriorGrant",
                        "newIntroduction",
                        "standardRate",
                        "noOptionalWageBonus"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "fiscalYear": {
                          "type": "integer",
                          "minimum": 2020,
                          "maximum": 2100
                        },
                        "frame": {
                          "const": "standard"
                        },
                        "vendorEntityKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "registrationHolderKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "toolNumber": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "productPlan": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "durationMonths": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 24
                        },
                        "eligibleCategories": {
                          "type": "array",
                          "items": {
                            "enum": [
                              "cloud",
                              "setup",
                              "migration"
                            ]
                          },
                          "minItems": 1,
                          "maxItems": 3,
                          "uniqueItems": true
                        },
                        "validUntil": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        },
                        "relationshipConfirmed": {
                          "type": "boolean"
                        }
                      },
                      "required": [
                        "fiscalYear",
                        "frame",
                        "vendorEntityKey",
                        "registrationHolderKey",
                        "toolNumber",
                        "productPlan",
                        "durationMonths",
                        "eligibleCategories",
                        "validUntil",
                        "relationshipConfirmed"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "vendorEntityKey": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "signed": {
                          "type": "boolean"
                        },
                        "returned": {
                          "type": "boolean"
                        },
                        "accepted": {
                          "type": "boolean"
                        },
                        "preAwardAutomaticOrder": {
                          "type": "boolean"
                        },
                        "officialDeadline": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        },
                        "vendorDeadline": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        }
                      },
                      "required": [
                        "vendorEntityKey",
                        "signed",
                        "returned",
                        "accepted",
                        "preAwardAutomaticOrder",
                        "officialDeadline",
                        "vendorDeadline"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "taxType": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        },
                        "period": {
                          "type": "object",
                          "properties": {
                            "start": {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                            },
                            "end": {
                              "type": "string",
                              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                            }
                          },
                          "required": [
                            "start",
                            "end"
                          ],
                          "additionalProperties": false
                        },
                        "unpaidYen": {
                          "anyOf": [
                            {
                              "type": "integer",
                              "minimum": 0,
                              "maximum": 9007199254740991
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "issuedOn": {
                          "type": "string",
                          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                        }
                      },
                      "required": [
                        "taxType",
                        "period",
                        "unpaidYen",
                        "issuedOn"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "problem": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1500
                        },
                        "objective": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1500
                        }
                      },
                      "required": [
                        "problem",
                        "objective"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "evidenceRefs": {
                  "type": "array",
                  "maxItems": 10,
                  "uniqueItems": true,
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  }
                },
                "unknownReason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                }
              },
              "required": [
                "questionId",
                "value",
                "evidenceRefs"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey",
          "answers"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_evaluate",
      "description": "確認済み事実から範囲・4層照合・計算・未充足を判定します。準備完了や採択を捏造しません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "scenarioId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_generate_outputs",
      "description": "確認結果・模擬転記ガイド・数値計画・添付対応・販売会社用確認票を非同期生成。未充足はassessment_reportで区切り、条件変更時だけ再開します。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "idempotencyKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "assessmentId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "kind": {
            "enum": [
              "preparation",
              "assessment_report"
            ]
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "expectedRevision",
          "idempotencyKey",
          "assessmentId",
          "kind"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_get_job",
      "description": "保存された処理の進捗・停止理由を取得します。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "jobId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "accessKey",
          "caseId",
          "jobId"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    },
    {
      "name": "assist_get_outputs",
      "description": "案件版に固定した成果物とWeb取得経路を取得します。旧版はstale。公式提出は行いません。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "accessKey": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "outputSetId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "accessKey",
          "caseId"
        ],
        "additionalProperties": false
      },
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false
      },
      "_meta": {
        "securitySchemes": [
          {
            "type": "noauth"
          }
        ]
      }
    }
  ]
} as const;
