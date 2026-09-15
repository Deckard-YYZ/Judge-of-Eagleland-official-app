import { ContentCatalogSchema, type ContentCatalog } from "../schema";

/**
 * 附录 A 的完整 case_001 加上附录 B 所需的第二案件、剧情和结局。
 * 视频路径只用于验证资源 ID 与 fallback 契约，仓库不要求此阶段提供真实媒体文件。
 */
const minimalCatalogData = {
  manifest: {
    packageId: "minimal-test-package",
    version: "1.0.0",
    contentSchemaVersion: 1,
    title: "最小联调内容包",
  },
  attributes: {
    restraint: {
      label: "克制",
      initial: 50,
      min: 0,
      max: 100,
    },
    authority: {
      label: "权威",
      initial: 50,
      min: 0,
      max: 100,
    },
  },
  initial: {
    caseIds: ["case_001"],
    storyIds: [],
    flags: {
      first_case_closed: false,
      second_case_reviewed: false,
    },
  },
  cases: {
    case_001: {
      id: "case_001",
      title: "第 001 号：夜间档案室事件",
      order: 10,
      characters: [
        {
          id: "clerk_lin",
          name: "林记录员",
          description: [
            {
              type: "paragraph",
              text: "在档案室任职三年的记录员。",
            },
          ],
        },
      ],
      summary: [
        {
          type: "paragraph",
          text: "一份未获授权带离的档案在次日清晨归还。",
        },
      ],
      body: [
        {
          type: "paragraph",
          text: "记录员承认将档案带回住处补录，但否认复制或转交其中的内容。",
        },
        {
          type: "paragraph",
          text: "值班簿存在一处时间涂改，现有材料无法确认由谁修改。",
        },
      ],
      startNodeId: "assessment",
      nodes: {
        assessment: {
          prompt: "你如何评价现有材料？",
          choices: [
            {
              id: "insufficient_evidence",
              text: "现有材料不足以支持进一步处分",
              annotation: {
                title: "材料限制",
                body: [
                  {
                    type: "paragraph",
                    text: "这一决定承认程序违规，但不推定存在材料以外的行为。",
                  },
                ],
              },
              target: {
                type: "resolution",
                resolutionId: "close_with_note",
              },
            },
            {
              id: "confirm_violation",
              text: "确认违规，继续确定处理方式",
              target: {
                type: "node",
                nodeId: "disposition",
              },
            },
          ],
        },
        disposition: {
          prompt: "确定最终处理方式。",
          choices: [
            {
              id: "formal_warning",
              text: "给予书面警告",
              target: {
                type: "resolution",
                resolutionId: "warning",
              },
            },
            {
              id: "suspend_access",
              text: "暂停档案访问权限",
              target: {
                type: "resolution",
                resolutionId: "suspension",
              },
            },
          ],
        },
      },
      resolutions: {
        close_with_note: {
          verdict: [
            {
              type: "paragraph",
              text: "保留程序违规记录，本次不追加处分。",
            },
          ],
          result: [
            {
              type: "paragraph",
              text: "档案室接受了决定，同时提出修订外借登记流程。",
            },
          ],
          effects: {
            attributeDeltas: {
              restraint: 3,
              authority: -2,
            },
            setFlags: {
              first_case_closed: true,
            },
          },
        },
        warning: {
          verdict: [
            {
              type: "paragraph",
              text: "给予书面警告，并要求完成内部流程培训。",
            },
          ],
          result: [
            {
              type: "paragraph",
              text: "记录员继续留任，后续材料交接将由两人签字。",
            },
          ],
          effects: {
            attributeDeltas: {
              restraint: 1,
              authority: 1,
            },
            setFlags: {
              first_case_closed: true,
            },
          },
        },
        suspension: {
          verdict: [
            {
              type: "paragraph",
              text: "暂停档案访问权限，等待后续内部安排。",
            },
          ],
          result: [
            {
              type: "paragraph",
              text: "档案室调整了当周排班，一部分积压工作被转交其他记录员。",
            },
          ],
          effects: {
            attributeDeltas: {
              restraint: -2,
              authority: 3,
            },
            setFlags: {
              first_case_closed: true,
            },
          },
        },
      },
    },
    case_002: {
      id: "case_002",
      title: "第 002 号：调阅权限申请",
      order: 20,
      characters: [
        {
          id: "analyst_zhou",
          name: "周分析员",
          description: [
            {
              type: "paragraph",
              text: "负责整理下一阶段案件材料的分析员。",
            },
          ],
        },
      ],
      summary: [
        {
          type: "paragraph",
          text: "一份临时调阅申请缺少一项复核签名。",
        },
      ],
      body: [
        {
          type: "paragraph",
          text: "申请人说明材料将在当天归档，但审批流程仍有一处待确认记录。",
        },
      ],
      startNodeId: "assessment",
      nodes: {
        assessment: {
          prompt: "你如何处理这份申请？",
          choices: [
            {
              id: "request_review",
              text: "要求补充复核后再调阅",
              target: {
                type: "resolution",
                resolutionId: "review_required",
              },
            },
            {
              id: "grant_access",
              text: "允许本次临时调阅",
              target: {
                type: "resolution",
                resolutionId: "temporary_access",
              },
            },
          ],
        },
      },
      resolutions: {
        review_required: {
          verdict: [
            {
              type: "paragraph",
              text: "补充复核记录后，方可继续调阅。",
            },
          ],
          result: [
            {
              type: "paragraph",
              text: "申请被退回补充材料。",
            },
          ],
          effects: {
            attributeDeltas: {
              restraint: 5,
            },
            setFlags: {
              second_case_reviewed: true,
            },
          },
        },
        temporary_access: {
          verdict: [
            {
              type: "paragraph",
              text: "在限定时间内允许临时调阅。",
            },
          ],
          result: [
            {
              type: "paragraph",
              text: "材料按期归还，后续复核记录另行补齐。",
            },
          ],
          effects: {
            attributeDeltas: {
              restraint: -5,
            },
            setFlags: {
              second_case_reviewed: true,
            },
          },
        },
      },
    },
  },
  unlockRules: [
    {
      id: "unlock_case_002_after_case_001",
      when: {
        all: [
          {
            type: "caseResolved",
            caseId: "case_001",
          },
        ],
      },
      caseIds: ["case_002"],
    },
  ],
  storyRules: [
    {
      id: "story_after_case_001_rule",
      when: {
        all: [
          {
            type: "caseResolved",
            caseId: "case_001",
          },
        ],
      },
      storyId: "story_after_case_001",
      order: 10,
    },
  ],
  stories: {
    story_after_case_001: {
      title: "档案室流程调整",
      skippable: true,
      steps: [
        {
          type: "text",
          blocks: [
            {
              type: "paragraph",
              text: "档案室开始执行新的双人交接流程。",
            },
          ],
        },
      ],
    },
    ending_balanced: {
      title: "平衡的裁定",
      skippable: false,
      steps: [
        {
          type: "video",
          assetId: "ending_balanced_video",
          fallbackBlocks: [
            {
              type: "paragraph",
              text: "终局影像暂时无法播放，但案件在克制中告一段落。",
            },
          ],
        },
        {
          type: "text",
          blocks: [
            {
              type: "paragraph",
              text: "两份案件均已处理，档案流程保持稳定。",
            },
          ],
        },
      ],
    },
    ending_fallback: {
      title: "继续审视",
      skippable: false,
      steps: [
        {
          type: "text",
          blocks: [
            {
              type: "paragraph",
              text: "两份案件均已处理，仍有新的问题等待审视。",
            },
          ],
        },
      ],
    },
  },
  endings: {
    balanced: {
      title: "平衡的裁定",
      priority: 100,
      when: {
        all: [
          {
            type: "resolvedCountAtLeast",
            count: 2,
          },
          {
            type: "attributeAtLeast",
            attributeId: "restraint",
            value: 50,
          },
        ],
      },
      storyId: "ending_balanced",
    },
    fallback: {
      title: "继续审视",
      priority: 10,
      when: {
        all: [
          {
            type: "resolvedCountAtLeast",
            count: 2,
          },
        ],
      },
      storyId: "ending_fallback",
    },
  },
  assets: {
    ending_balanced_video: {
      kind: "video",
      path: "media/videos/ending-balanced.mp4",
    },
  },
};

export const MINIMAL_CATALOG: ContentCatalog = ContentCatalogSchema.parse(minimalCatalogData);
