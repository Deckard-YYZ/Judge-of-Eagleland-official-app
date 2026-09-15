import {
  GameContentCatalogSchema,
  LocalizedContentCatalogSchema,
  type GameContentCatalog,
  type LocalizedContentCatalog,
} from "../schema";

const p = (text: string) => [{ type: "paragraph" as const, text }];

const gameContentData = {
  manifest: {
    packageId: "minimal-test-package",
    version: "1.0.0",
    contentSchemaVersion: 2,
    defaultLocale: "zh-CN",
    supportedLocales: ["zh-CN", "en-US"],
  },
  attributes: {
    restraint: { initial: 50, min: 0, max: 100 },
    authority: { initial: 50, min: 0, max: 100 },
  },
  initial: {
    caseIds: ["case_001"],
    storyIds: [],
    flags: { first_case_closed: false, second_case_reviewed: false },
  },
  cases: {
    case_001: {
      id: "case_001",
      order: 10,
      characters: [{ id: "clerk_lin" }],
      startNodeId: "assessment",
      nodes: {
        assessment: {
          choices: [
            {
              id: "insufficient_evidence",
              hasAnnotation: true,
              target: { type: "resolution", resolutionId: "close_with_note" },
            },
            {
              id: "confirm_violation",
              hasAnnotation: false,
              target: { type: "node", nodeId: "disposition" },
            },
          ],
        },
        disposition: {
          choices: [
            {
              id: "formal_warning",
              hasAnnotation: false,
              target: { type: "resolution", resolutionId: "warning" },
            },
            {
              id: "suspend_access",
              hasAnnotation: false,
              target: { type: "resolution", resolutionId: "suspension" },
            },
          ],
        },
      },
      resolutions: {
        close_with_note: {
          effects: {
            attributeDeltas: { restraint: 3, authority: -2 },
            setFlags: { first_case_closed: true },
          },
        },
        warning: {
          effects: {
            attributeDeltas: { restraint: 1, authority: 1 },
            setFlags: { first_case_closed: true },
          },
        },
        suspension: {
          effects: {
            attributeDeltas: { restraint: -2, authority: 3 },
            setFlags: { first_case_closed: true },
          },
        },
      },
    },
    case_002: {
      id: "case_002",
      order: 20,
      characters: [{ id: "analyst_zhou" }],
      startNodeId: "assessment",
      nodes: {
        assessment: {
          choices: [
            {
              id: "request_review",
              hasAnnotation: false,
              target: { type: "resolution", resolutionId: "review_required" },
            },
            {
              id: "grant_access",
              hasAnnotation: false,
              target: { type: "resolution", resolutionId: "temporary_access" },
            },
          ],
        },
      },
      resolutions: {
        review_required: {
          effects: {
            attributeDeltas: { restraint: 5 },
            setFlags: { second_case_reviewed: true },
          },
        },
        temporary_access: {
          effects: {
            attributeDeltas: { restraint: -5 },
            setFlags: { second_case_reviewed: true },
          },
        },
      },
    },
  },
  unlockRules: [
    {
      id: "unlock_case_002_after_case_001",
      when: { all: [{ type: "caseResolved", caseId: "case_001" }] },
      caseIds: ["case_002"],
    },
  ],
  storyRules: [
    {
      id: "story_after_case_001_rule",
      when: { all: [{ type: "caseResolved", caseId: "case_001" }] },
      storyId: "story_after_case_001",
      order: 10,
    },
  ],
  stories: {
    story_after_case_001: {
      skippable: true,
      steps: [{ id: "notice", type: "text" }],
    },
    ending_balanced: {
      skippable: false,
      steps: [
        { id: "closing_video", type: "video", assetId: "ending_balanced_video" },
        { id: "closing_text", type: "text" },
      ],
    },
    ending_fallback: {
      skippable: false,
      steps: [{ id: "closing_text", type: "text" }],
    },
  },
  endings: {
    balanced: {
      priority: 100,
      when: {
        all: [
          { type: "resolvedCountAtLeast", count: 2 },
          { type: "attributeAtLeast", attributeId: "restraint", value: 50 },
        ],
      },
      storyId: "ending_balanced",
    },
    fallback: {
      priority: 10,
      when: { all: [{ type: "resolvedCountAtLeast", count: 2 }] },
      storyId: "ending_fallback",
    },
  },
  assets: {
    ending_balanced_video: { kind: "video", path: "media/videos/ending-balanced.mp4" },
  },
};

const zhCnData = {
  packageId: "minimal-test-package",
  version: "1.0.0",
  locale: "zh-CN",
  manifest: { title: "最小联调内容包" },
  attributes: { restraint: { label: "克制" }, authority: { label: "权威" } },
  cases: {
    case_001: {
      title: "第 001 号：夜间档案室事件",
      characters: {
        clerk_lin: { name: "林记录员", description: p("在档案室任职三年的记录员。") },
      },
      summary: p("一份未获授权带离的档案在次日清晨归还。"),
      body: [
        ...p("记录员承认将档案带回住处补录，但否认复制或转交其中的内容。"),
        ...p("值班簿存在一处时间涂改，现有材料无法确认由谁修改。"),
      ],
      nodes: {
        assessment: { prompt: "你如何评价现有材料？" },
        disposition: { prompt: "确定最终处理方式。" },
      },
      choices: {
        insufficient_evidence: {
          text: "现有材料不足以支持进一步处分",
          annotation: {
            title: "材料限制",
            body: p("这一决定承认程序违规，但不推定存在材料以外的行为。"),
          },
        },
        confirm_violation: { text: "确认违规，继续确定处理方式" },
        formal_warning: { text: "给予书面警告" },
        suspend_access: { text: "暂停档案访问权限" },
      },
      resolutions: {
        close_with_note: {
          verdict: p("保留程序违规记录，本次不追加处分。"),
          result: p("档案室接受了决定，同时提出修订外借登记流程。"),
        },
        warning: {
          verdict: p("给予书面警告，并要求完成内部流程培训。"),
          result: p("记录员继续留任，后续材料交接将由两人签字。"),
        },
        suspension: {
          verdict: p("暂停档案访问权限，等待后续内部安排。"),
          result: p("档案室调整了当周排班，一部分积压工作被转交其他记录员。"),
        },
      },
    },
    case_002: {
      title: "第 002 号：调阅权限申请",
      characters: {
        analyst_zhou: { name: "周分析员", description: p("负责整理下一阶段案件材料的分析员。") },
      },
      summary: p("一份临时调阅申请缺少一项复核签名。"),
      body: p("申请人说明材料将在当天归档，但审批流程仍有一处待确认记录。"),
      nodes: { assessment: { prompt: "你如何处理这份申请？" } },
      choices: {
        request_review: { text: "要求补充复核后再调阅" },
        grant_access: { text: "允许本次临时调阅" },
      },
      resolutions: {
        review_required: {
          verdict: p("补充复核记录后，方可继续调阅。"),
          result: p("申请被退回补充材料。"),
        },
        temporary_access: {
          verdict: p("在限定时间内允许临时调阅。"),
          result: p("材料按期归还，后续复核记录另行补齐。"),
        },
      },
    },
  },
  stories: {
    story_after_case_001: {
      title: "档案室流程调整",
      steps: { notice: { blocks: p("档案室开始执行新的双人交接流程。") } },
    },
    ending_balanced: {
      title: "平衡的裁定",
      steps: {
        closing_video: { blocks: p("终局影像暂时无法播放，但案件在克制中告一段落。") },
        closing_text: { blocks: p("两份案件均已处理，档案流程保持稳定。") },
      },
    },
    ending_fallback: {
      title: "继续审视",
      steps: { closing_text: { blocks: p("两份案件均已处理，仍有新的问题等待审视。") } },
    },
  },
  endings: { balanced: { title: "平衡的裁定" }, fallback: { title: "继续审视" } },
};

const enUsData = {
  packageId: "minimal-test-package",
  version: "1.0.0",
  locale: "en-US",
  manifest: { title: "Minimal integration package" },
  attributes: { restraint: { label: "Restraint" }, authority: { label: "Authority" } },
  cases: {
    case_001: {
      title: "Case 001: The Night Archive Incident",
      characters: {
        clerk_lin: {
          name: "Records Clerk Lin",
          description: p("A clerk who has worked in the archive for three years."),
        },
      },
      summary: p("A file removed without authorization was returned the next morning."),
      body: [
        ...p(
          "The clerk admits taking the file home to finish an entry, but denies copying or sharing it.",
        ),
        ...p(
          "One time entry in the duty log was altered, and the available evidence does not identify who changed it.",
        ),
      ],
      nodes: {
        assessment: { prompt: "How do you assess the available evidence?" },
        disposition: { prompt: "Choose the final disposition." },
      },
      choices: {
        insufficient_evidence: {
          text: "The evidence does not support further discipline",
          annotation: {
            title: "Limits of the record",
            body: p(
              "This ruling acknowledges the procedural breach without assuming conduct beyond the evidence.",
            ),
          },
        },
        confirm_violation: { text: "Confirm the breach and determine a disposition" },
        formal_warning: { text: "Issue a written warning" },
        suspend_access: { text: "Suspend archive access" },
      },
      resolutions: {
        close_with_note: {
          verdict: p("Record the procedural breach without additional discipline."),
          result: p("The archive accepts the ruling and proposes a revised checkout process."),
        },
        warning: {
          verdict: p("Issue a written warning and require internal procedure training."),
          result: p("The clerk remains in post, with two signatures required for later transfers."),
        },
        suspension: {
          verdict: p("Suspend archive access pending internal arrangements."),
          result: p("The archive revises the week's schedule and reassigns part of the backlog."),
        },
      },
    },
    case_002: {
      title: "Case 002: Archive Access Request",
      characters: {
        analyst_zhou: {
          name: "Analyst Zhou",
          description: p("The analyst preparing materials for the next stage of review."),
        },
      },
      summary: p("A temporary access request is missing one review signature."),
      body: p(
        "The applicant says the material will be returned today, but one approval record remains unconfirmed.",
      ),
      nodes: { assessment: { prompt: "How will you handle this request?" } },
      choices: {
        request_review: { text: "Require review before granting access" },
        grant_access: { text: "Allow temporary access this time" },
      },
      resolutions: {
        review_required: {
          verdict: p("Complete the review record before access may continue."),
          result: p("The request is returned for additional documentation."),
        },
        temporary_access: {
          verdict: p("Allow temporary access within a limited period."),
          result: p(
            "The material is returned on time and the review record will be completed separately.",
          ),
        },
      },
    },
  },
  stories: {
    story_after_case_001: {
      title: "Archive Procedure Revised",
      steps: { notice: { blocks: p("The archive adopts a two-person transfer procedure.") } },
    },
    ending_balanced: {
      title: "A Balanced Judgment",
      steps: {
        closing_video: {
          blocks: p("The ending video is unavailable, but the cases close with restraint."),
        },
        closing_text: { blocks: p("Both cases are resolved and the archive remains stable.") },
      },
    },
    ending_fallback: {
      title: "Continue the Review",
      steps: {
        closing_text: {
          blocks: p("Both cases are resolved, with further questions still to examine."),
        },
      },
    },
  },
  endings: {
    balanced: { title: "A Balanced Judgment" },
    fallback: { title: "Continue the Review" },
  },
};

export const MINIMAL_GAME_CONTENT: GameContentCatalog =
  GameContentCatalogSchema.parse(gameContentData);
export const MINIMAL_ZH_CN: LocalizedContentCatalog = LocalizedContentCatalogSchema.parse(zhCnData);
export const MINIMAL_EN_US: LocalizedContentCatalog = LocalizedContentCatalogSchema.parse(enUsData);
export const MINIMAL_LOCALIZATIONS = {
  "zh-CN": MINIMAL_ZH_CN,
  "en-US": MINIMAL_EN_US,
} as const;
