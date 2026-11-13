// RB-1: the demo's code. Made-up repos for the demo clients, answered in memory: a semantic model (TMDL with
// measures), a report, a Fabric pipeline, a Data Factory pipeline, SQL scripts and a SQL project, a notebook stored as
// source, YAML, PowerShell and a README, plus one JSON file squashed onto one line, a binary file, an image, a file over
// the size limit and a Git LFS pointer. Harbor shows "can't read yet" (its token lacks Code (read)) and Fabrikam is set
// to its team only (server/demo.ts). Everything here is invented: no real client, person, repo or code. Only
// server/demo.ts imports this (host/no-demo-leak.test.ts), so a real session never reaches it.
import { CodeFailure, type CodeFile, type CodeGit } from "../../actions/code-git.ts";
import type { GitRepo } from "../devops/git.ts";
import { decodeText, fileKind, nameOf, sortEntries, TEXT_MAX_BYTES, type CodeEntry } from "../../plan/code.ts";

const COMMIT = "0d3e5f7a9b1c2d4e6f8091a2b3c4d5e6f7a8b9c0";

/** A file's content: text, raw bytes, or only a size (the file over the limit is never built). */
type Content = string | Uint8Array | { size: number };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const BIN = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0, 0x21, 0, 0x7e, 0x3f, 0, 0, 0, 0, 0x6d, 0x61, 0x63, 0x72, 0x6f]);

const MODEL_TMDL = `model Model
	culture: en-US
	defaultPowerBIDataSourceVersion: powerBI_V3
	sourceQueryCulture: en-US
	discourageImplicitMeasures

	annotation PBI_QueryOrder = ["Sales","Date","Store"]

	annotation __PBI_TimeIntelligenceEnabled = 0

ref table Sales
ref table Date
ref table Store

ref cultureInfo en-US
`;

const SALES_TMDL = `/// Every order line from the warehouse, one row per line.
table Sales
	lineageTag: 6b1f0c2e-41a7-4d3b-9a55-1c7e2f0d8a11

	/// Sales after discounts, before tax.
	measure 'Total Sales' = SUM ( Sales[Amount] )
		formatString: \\$#,0.00
		displayFolder: Revenue
		lineageTag: 2e9d7c40-1f3b-4a6e-8b52-0c4d1e7f9a23

	measure 'Sales YTD' =
			CALCULATE (
				[Total Sales],
				DATESYTD ( 'Date'[Date] )
			)
		formatString: \\$#,0
		displayFolder: Revenue
		lineageTag: 9a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9

	measure 'Margin %' = DIVIDE ( [Total Sales] - [Total Cost], [Total Sales] )
		formatString: 0.0%
		lineageTag: 5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f

	measure 'Orders' = DISTINCTCOUNT ( Sales[OrderId] )
		formatString: #,0
		lineageTag: 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d

	column OrderId
		dataType: int64
		formatString: 0
		lineageTag: 7f8e9d0c-1b2a-4394-8576-a1b2c3d4e5f6
		summarizeBy: none
		sourceColumn: OrderId

		annotation SummarizationSetBy = Automatic

	column OrderDate
		dataType: dateTime
		formatString: Long Date
		lineageTag: 3d4c5b6a-7980-4a1b-9c2d-e3f4a5b6c7d8
		summarizeBy: none
		sourceColumn: OrderDate

	column Amount
		dataType: decimal
		formatString: \\$#,0.00
		lineageTag: 8e7d6c5b-4a39-4281-9706-f5e4d3c2b1a0
		summarizeBy: sum
		sourceColumn: Amount

	column 'Store Key'
		dataType: int64
		isHidden
		lineageTag: 0a9b8c7d-6e5f-4403-9211-0f1e2d3c4b5a
		summarizeBy: none
		sourceColumn: StoreKey

	partition Sales = m
		mode: import
		source =
				let
				    Source = Sql.Database("demo-sql.example.com", "Warehouse"),
				    Orders = Source{[Schema = "dbo", Item = "vSales"]}[Data],
				    Typed = Table.TransformColumnTypes(Orders, {{"Amount", type number}, {"OrderDate", type datetime}}),
				    Recent = Table.SelectRows(Typed, each [OrderDate] >= #datetime(2024, 1, 1, 0, 0, 0))
				in
				    Recent

	annotation PBI_ResultType = Table
`;

const DATE_TMDL = `table Date
	dataCategory: Time
	lineageTag: 4b5a6978-8796-4a5b-b4c3-d2e1f0a9b8c7

	column Date
		dataType: dateTime
		isKey
		formatString: Short Date
		lineageTag: c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f
		summarizeBy: none
		sourceColumn: Date

	column Year = YEAR ( 'Date'[Date] )
		dataType: int64
		formatString: 0
		lineageTag: d2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60
		summarizeBy: none

	partition Date = calculated
		mode: import
		source = CALENDAR ( DATE ( 2023, 1, 1 ), DATE ( 2026, 12, 31 ) )
`;

const RELATIONSHIPS_TMDL = `relationship 5e2f8a10-3c4d-4b6e-9f70-81a2b3c4d5e6
	fromColumn: Sales.OrderDate
	toColumn: Date.Date

relationship 6f3a9b21-4d5e-4c7f-8a81-92b3c4d5e6f7
	fromColumn: Sales.'Store Key'
	toColumn: Store.'Store Key'
`;

const ROLES_TMDL = `role 'Store managers'
	modelPermission: read

	tablePermission Store = [Manager Email] = USERPRINCIPALNAME ()
`;

const PLATFORM = (type: string, name: string) => `{
  "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
  "metadata": {
    "type": "${type}",
    "displayName": "${name}"
  },
  "config": {
    "version": "2.0",
    "logicalId": "00000000-0000-0000-0000-000000000000"
  }
}
`;

const REPORT_JSON = JSON.stringify({
  config: JSON.stringify({ version: "5.43", themeCollection: { baseTheme: { name: "CY24SU06" } }, activeSectionIndex: 0 }),
  layoutOptimization: 0,
  resourcePackages: [{ resourcePackage: { name: "SharedResources", type: 2, items: [{ name: "CY24SU06", path: "BaseThemes/CY24SU06.json", type: 202 }] } }],
  sections: [
    { name: "ReportSection", displayName: "Overview", displayOption: 1, height: 720, width: 1280, visualContainers: [{ x: 24, y: 24, z: 0, width: 400, height: 220, config: JSON.stringify({ name: "card1", singleVisual: { visualType: "card", projections: { Values: [{ queryRef: "Sales.Total Sales" }] } } }) }, { x: 440, y: 24, z: 1, width: 800, height: 420, config: JSON.stringify({ name: "line1", singleVisual: { visualType: "lineChart", projections: { Category: [{ queryRef: "Date.Date" }], Y: [{ queryRef: "Sales.Sales YTD" }] } } }) }] },
    { name: "ReportSection2", displayName: "Stores", displayOption: 1, height: 720, width: 1280, visualContainers: [] },
  ],
});

const FABRIC_PIPELINE = `{
  "properties": {
    "activities": [
      {
        "name": "Copy orders to Lakehouse",
        "type": "Copy",
        "dependsOn": [],
        "policy": { "timeout": "0.12:00:00", "retry": 2, "retryIntervalInSeconds": 30 },
        "typeProperties": {
          "source": { "type": "SqlServerSource", "queryTimeout": "02:00:00" },
          "sink": { "type": "LakehouseTableSink", "tableActionOption": "Append" },
          "enableStaging": false
        }
      },
      {
        "name": "Clean orders",
        "type": "TridentNotebook",
        "dependsOn": [{ "activity": "Copy orders to Lakehouse", "dependencyConditions": ["Succeeded"] }],
        "typeProperties": { "notebookId": "11111111-2222-4333-8444-555555555555", "parameters": { "load_date": { "value": "@pipeline().TriggerTime", "type": "string" } } }
      }
    ],
    "parameters": { "full_load": { "type": "bool", "defaultValue": false } }
  }
}
`;

const NOTEBOOK = `# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": { "name": "synapse_pyspark" },
# META   "dependencies": { "lakehouse": { "default_lakehouse_name": "Sales" } }
# META }

# PARAMETERS CELL ********************

load_date = "2024-01-01"

# CELL ********************

from pyspark.sql import functions as F

orders = spark.read.table("raw_orders")
clean = (
    orders
    .where(F.col("Amount") > 0)
    .withColumn("OrderDate", F.to_date("OrderDate"))
    .dropDuplicates(["OrderId", "LineNo"])
)
clean.write.mode("overwrite").saveAsTable("orders")

# CELL ********************

display(clean.groupBy("StoreKey").agg(F.sum("Amount").alias("Sales")))
`;

const ADF_PIPELINE = `{
  "name": "pl_copy_shipments",
  "properties": {
    "activities": [
      {
        "name": "Lookup watermark",
        "type": "Lookup",
        "typeProperties": {
          "source": { "type": "AzureSqlSource", "sqlReaderQuery": "SELECT MAX(LoadedAt) AS Watermark FROM etl.Watermarks WHERE TableName = 'Shipments'" },
          "dataset": { "referenceName": "ds_sql_watermarks", "type": "DatasetReference" }
        }
      },
      {
        "name": "Copy new shipments",
        "type": "Copy",
        "dependsOn": [{ "activity": "Lookup watermark", "dependencyConditions": ["Succeeded"] }],
        "inputs": [{ "referenceName": "ds_rest_shipments", "type": "DatasetReference" }],
        "outputs": [{ "referenceName": "ds_adls_shipments", "type": "DatasetReference" }],
        "typeProperties": {
          "source": { "type": "RestSource", "requestMethod": "GET", "paginationRules": { "AbsoluteUrl": "$.next" } },
          "sink": { "type": "ParquetSink" }
        }
      }
    ],
    "annotations": ["shipments"],
    "folder": { "name": "Ingest" }
  }
}
`;

const LINKED_SERVICE = `{
  "name": "ls_adls",
  "properties": {
    "type": "AzureBlobFS",
    "typeProperties": { "url": "https://demostorage.dfs.core.windows.net/" },
    "connectVia": { "referenceName": "AutoResolveIntegrationRuntime", "type": "IntegrationRuntimeReference" }
  }
}
`;

const DATASET = `{
  "name": "ds_adls_shipments",
  "properties": {
    "linkedServiceName": { "referenceName": "ls_adls", "type": "LinkedServiceReference" },
    "type": "Parquet",
    "typeProperties": {
      "location": { "type": "AzureBlobFSLocation", "fileSystem": "raw", "folderPath": "shipments" },
      "compressionCodec": "snappy"
    }
  }
}
`;

const ORDERS_SQL = `CREATE TABLE [dbo].[Orders]
(
    [OrderId]    INT            NOT NULL,
    [LineNo]     SMALLINT       NOT NULL,
    [OrderDate]  DATE           NOT NULL,
    [StoreKey]   INT            NOT NULL,
    [Amount]     DECIMAL(18, 2) NOT NULL,
    [LoadedAt]   DATETIME2(3)   NOT NULL CONSTRAINT [DF_Orders_LoadedAt] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED ([OrderId], [LineNo])
);
GO

CREATE NONCLUSTERED INDEX [IX_Orders_OrderDate] ON [dbo].[Orders] ([OrderDate]) INCLUDE ([Amount]);
`;

const VSALES_SQL = `-- One row per order line, with the store's region, for the semantic model.
CREATE VIEW [dbo].[vSales]
AS
SELECT
    o.[OrderId],
    o.[LineNo],
    o.[OrderDate],
    o.[StoreKey],
    s.[Region],
    o.[Amount]
FROM [dbo].[Orders] AS o
JOIN [dbo].[Stores] AS s
    ON s.[StoreKey] = o.[StoreKey]
WHERE o.[Amount] > 0;
`;

const LOAD_SQL = `CREATE PROCEDURE [etl].[usp_LoadOrders]
    @LoadDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @LoadDate = COALESCE(@LoadDate, CAST(SYSUTCDATETIME() AS DATE));

    MERGE [dbo].[Orders] AS t
    USING (SELECT * FROM [stage].[Orders] WHERE [OrderDate] = @LoadDate) AS s
        ON t.[OrderId] = s.[OrderId] AND t.[LineNo] = s.[LineNo]
    WHEN MATCHED AND t.[Amount] <> s.[Amount] THEN
        UPDATE SET t.[Amount] = s.[Amount], t.[LoadedAt] = SYSUTCDATETIME()
    WHEN NOT MATCHED BY TARGET THEN
        INSERT ([OrderId], [LineNo], [OrderDate], [StoreKey], [Amount])
        VALUES (s.[OrderId], s.[LineNo], s.[OrderDate], s.[StoreKey], s.[Amount]);

    UPDATE [etl].[Watermarks] SET [LoadedAt] = SYSUTCDATETIME() WHERE [TableName] = N'Orders';
END;
`;

const SQLPROJ = `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build">
  <Sdk Name="Microsoft.Build.Sql" Version="0.1.12-preview" />
  <PropertyGroup>
    <Name>Warehouse</Name>
    <DSP>Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider</DSP>
    <ModelCollation>1033, CI</ModelCollation>
  </PropertyGroup>
  <ItemGroup>
    <Folder Include="dbo\\Tables" />
    <Folder Include="dbo\\Views" />
    <Folder Include="etl\\StoredProcedures" />
  </ItemGroup>
</Project>
`;

const PIPELINE_YML = `# Builds the SQL project and deploys it to the test database.
trigger:
  branches:
    include: [main]
  paths:
    include: [sql/*]

pool:
  vmImage: ubuntu-latest

variables:
  - name: project
    value: sql/Warehouse.sqlproj

steps:
  - task: DotNetCoreCLI@2
    displayName: Build the SQL project
    inputs:
      command: build
      projects: $(project)

  - task: SqlAzureDacpacDeployment@1
    displayName: Deploy to test
    inputs:
      azureSubscription: demo-test-connection
      ServerName: demo-sql.example.com
      DatabaseName: Warehouse
      DacpacFile: sql/bin/Debug/Warehouse.dacpac
`;

const DEPLOY_PS1 = `<#
.SYNOPSIS
  Publishes the report and the semantic model to a workspace (demo).
#>
param(
    [Parameter(Mandatory = $true)] [string] $Workspace,
    [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'
$items = Get-ChildItem -Path "$PSScriptRoot/.." -Filter '*.platform' -Recurse

foreach ($item in $items) {
    $meta = Get-Content $item.FullName -Raw | ConvertFrom-Json
    Write-Host "Publishing $($meta.metadata.displayName) to $Workspace"
    if (-not $WhatIf) {
        # Invoke-FabricPublish is the team's own module (not included in the demo).
        Invoke-FabricPublish -Workspace $Workspace -Path $item.DirectoryName
    }
}
`;

const README = (what: string) => `# ${what}

A made-up repo for FocusTime's demo. Nothing here is real.

## What's here

- \`model/\`: the Sales semantic model in TMDL (tables, measures, relationships, roles)
- \`report/\`: the Sales report definition
- \`pipelines/\`: a Fabric data pipeline and a notebook stored as source
- \`sql/\`: the warehouse's SQL project

## Deploy

Run \`deploy/Deploy.ps1 -Workspace "Sales (test)"\` from a shell signed in to the test tenant.
`;

const LFS = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393
size 48213764
`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" onload="alert('svg ran')">
  <rect width="64" height="64" rx="12" fill="#1f9e8f" />
  <script>alert("svg script ran")</script>
  <text x="32" y="40" text-anchor="middle" font-size="20" fill="#fff">NW</text>
</svg>
`;

const HTML = `<!doctype html>
<html>
  <head><title>Store map</title></head>
  <body>
    <h1>Store map</h1>
    <img src="x" onerror="alert('img ran')">
    <script>document.body.dataset.ran = "yes"; alert("page script ran");</script>
  </body>
</html>
`;

/** The demo's repos: per client, per repo, each file by path. */
type DemoRepo = { id: string; name: string; files: Record<string, Content> };
const sales = (): Record<string, Content> => ({
  "/README.md": README("Sales analytics"),
  "/model/Sales.SemanticModel/definition/model.tmdl": MODEL_TMDL,
  "/model/Sales.SemanticModel/definition/tables/Sales.tmdl": SALES_TMDL,
  "/model/Sales.SemanticModel/definition/tables/Date.tmdl": DATE_TMDL,
  "/model/Sales.SemanticModel/definition/relationships.tmdl": RELATIONSHIPS_TMDL,
  "/model/Sales.SemanticModel/definition/roles/Store managers.tmdl": ROLES_TMDL,
  "/model/Sales.SemanticModel/.platform": PLATFORM("SemanticModel", "Sales"),
  "/report/Sales.Report/report.json": REPORT_JSON,
  "/report/Sales.Report/definition.pbir": `{\n  "version": "4.0",\n  "datasetReference": { "byPath": { "path": "../../model/Sales.SemanticModel" } }\n}\n`,
  "/report/Sales.Report/StaticResources/logo.svg": SVG,
  "/report/Sales.Report/.platform": PLATFORM("Report", "Sales"),
  "/pipelines/Load sales.DataPipeline/pipeline-content.json": FABRIC_PIPELINE,
  "/pipelines/Load sales.DataPipeline/.platform": PLATFORM("DataPipeline", "Load sales"),
  "/pipelines/Clean orders.Notebook/notebook-content.py": NOTEBOOK,
  "/pipelines/Clean orders.Notebook/.platform": PLATFORM("Notebook", "Clean orders"),
  "/sql/Warehouse.sqlproj": SQLPROJ,
  "/sql/dbo/Tables/Orders.sql": ORDERS_SQL,
  "/sql/dbo/Views/vSales.sql": VSALES_SQL,
  "/sql/etl/StoredProcedures/usp_LoadOrders.sql": LOAD_SQL,
  "/deploy/Deploy.ps1": DEPLOY_PS1,
  "/azure-pipelines.yml": PIPELINE_YML,
  "/docs/store-map.html": HTML,
  "/docs/architecture.png": PNG,
  "/docs/Sales model.pbix": BIN,
  "/data/sample-orders.csv": { size: 3_400_000 },
  "/data/history.parquet": LFS,
});
const ingest = (): Record<string, Content> => ({
  "/README.md": README("Freight ingest").replace(/## What's here[\s\S]*?## Deploy/, "## What's here\n\n- `adf/`: the Data Factory pipelines, datasets and linked services\n- `sql/`: watermark scripts\n\n## Deploy"),
  "/adf/pipeline/pl_copy_shipments.json": ADF_PIPELINE,
  "/adf/linkedService/ls_adls.json": LINKED_SERVICE,
  "/adf/dataset/ds_adls_shipments.json": DATASET,
  "/sql/etl/Tables/Watermarks.sql": "CREATE TABLE [etl].[Watermarks]\n(\n    [TableName] SYSNAME      NOT NULL PRIMARY KEY,\n    [LoadedAt]  DATETIME2(3) NULL\n);\n",
  "/azure-pipelines.yml": PIPELINE_YML.replace("sql/*", "adf/*"),
});
const internal = (): Record<string, Content> => ({
  "/README.md": "# Delivery toolkit\n\nShared scripts the team reuses across projects (demo).\n",
  "/scripts/New-Workspace.ps1": DEPLOY_PS1.replace("Publishes the report and the semantic model", "Creates a workspace and assigns a capacity"),
  "/templates/pipeline.yml": PIPELINE_YML,
  "/templates/model/model.tmdl": MODEL_TMDL,
});

const REPOS: Record<string, DemoRepo[] | "needs_code_read"> = {
  Northwind: [
    { id: "a1b2c3d4-0001-4000-8000-00000000a001", name: "sales-analytics", files: sales() },
    { id: "a1b2c3d4-0002-4000-8000-00000000a002", name: "store-portal", files: { "/README.md": "# Store portal\n\nNot moved to this repo yet (demo).\n" } },
    { id: "a1b2c3d4-0006-4000-8000-00000000a006", name: "archive", files: {} },
  ],
  Atlas: [{ id: "a1b2c3d4-0003-4000-8000-00000000a003", name: "freight-ingest", files: ingest() }],
  Cooptimize: [{ id: "a1b2c3d4-0004-4000-8000-00000000a004", name: "delivery-toolkit", files: internal() }],
  Fabrikam: [{ id: "a1b2c3d4-0005-4000-8000-00000000a005", name: "fiber-reporting", files: sales() }],
  Harbor: "needs_code_read",
};
const ORGS: Record<string, { org: string; project: string }> = {
  Northwind: { org: "northwind-demo", project: "Portal" },
  Atlas: { org: "atlas-demo", project: "Logistics" },
  Cooptimize: { org: "cooptimize-demo", project: "Internal" },
  Fabrikam: { org: "fabrikam-demo", project: "Fiber" },
};

const enc = new TextEncoder();
const bytesOf = (c: Content): Uint8Array | null => (typeof c === "string" ? enc.encode(c) : c instanceof Uint8Array ? c : null);
const sizeOf = (c: Content): number => (typeof c === "string" ? enc.encode(c).length : c instanceof Uint8Array ? c.length : c.size);

function reposOf(clientKey: string): DemoRepo[] {
  const r = REPOS[clientKey];
  if (r === "needs_code_read") throw new CodeFailure("needs_code_read");
  if (!r) throw new CodeFailure("no_devops");
  return r;
}
function find(clientKey: string, repo: GitRepo): DemoRepo {
  const r = reposOf(clientKey).find((x) => x.id === repo.id);
  if (!r) throw new CodeFailure("not_found");
  return r;
}

/** The demo's CodeGit: the same shape a real session's has, over the made-up repos above. */
export function demoCodeGit(): CodeGit {
  return {
    async repos(clientKey) {
      const o = ORGS[clientKey];
      return reposOf(clientKey)
        .map((r) => ({ id: r.id, name: r.name, defaultBranch: Object.keys(r.files).length ? "main" : null, disabled: false, webUrl: o ? `https://dev.azure.com/${o.org}/${encodeURIComponent(o.project)}/_git/${r.name}` : null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async folder(clientKey, repo, path) {
      const r = find(clientKey, repo);
      const prefix = path === "/" ? "/" : `${path}/`;
      const seen = new Map<string, CodeEntry>();
      for (const p of Object.keys(r.files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash < 0 ? rest : rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, { name, path: prefix + name, folder: slash >= 0 });
      }
      if (path !== "/" && seen.size === 0) throw new CodeFailure("not_found");
      return { commit: COMMIT, entries: sortEntries([...seen.values()]), cut: false };
    },
    async files(clientKey, repo) {
      const r = find(clientKey, repo);
      return { commit: COMMIT, paths: Object.keys(r.files).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })), cut: false };
    },
    async file(clientKey, repo, path): Promise<CodeFile> {
      const c = find(clientKey, repo).files[path];
      if (c === undefined) throw new CodeFailure("not_found");
      const size = sizeOf(c);
      const bytes = size > TEXT_MAX_BYTES ? null : bytesOf(c);
      const kind = fileKind({ name: nameOf(path), size, bytes });
      return { path, commit: COMMIT, size, kind, text: (kind === "text" || kind === "lfs") && bytes ? decodeText(bytes) : null };
    },
  };
}
