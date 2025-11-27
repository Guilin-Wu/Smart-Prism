/* eslint-disable no-undef */
'use strict';


// 1. 全局配置与状态
localforage.config({
    name: 'SmartPrismDB',
    storeName: 'app_data',
    description: '存储学生成绩、小题分析及考试归档数据'
});

// ---------------------------------
// 1. 全局配置与状态
// ---------------------------------
// 默认科目列表，仅用于程序首次加载
const DEFAULT_SUBJECT_LIST = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];
// G_DynamicSubjectList 现在是唯一的科目来源，默认等于 DEFAULT_SUBJECT_LIST
let G_DynamicSubjectList = [...DEFAULT_SUBJECT_LIST];

// 存储数据
let G_StudentsData = []; // { id, name, class, totalScore, rank, gradeRank, scores: {...} }
let G_CompareData = [];  // 同上, 用于对比
//let G_MultiExamData = [];
let G_Statistics = {};   // 存储当前 *已筛选* 后的统计数据
let G_ItemAnalysisData = {};
let G_ItemAnalysisConfig = {};
let G_ItemOutlierList = [];
let G_ItemDetailSort = { key: 'deviation', direction: 'asc' }; //  缓存学生详情表的排序状态
let G_CompareStatistics = {};
let G_TrendSort = { key: 'rank', direction: 'asc' }; //   趋势模块的排序状态
let G_DashboardTableSort = { key: 'totalScore', direction: 'desc' };
let currentAIController = null;
// 全局变量：存储 AI 对话历史
let G_AIChatHistory = [];

let G_CurrentHistoryId = null;

// 存储UI状态
let G_CurrentClassFilter = 'ALL';
let G_CurrentImportType = 'main';
let G_SubjectConfigs = {};

// 全局变量：存储身高/性别数据 { id: { gender: '男', height: 175 }, ... }
let G_PhysicalData = {};
let G_CurrentSeatMap = null; // 缓存结果用于导出

// 目标规划模块的专用数据源
let G_GoalBaselineData = null; // 基准成绩
let G_GoalOutcomeData = null;  // 复盘成绩

// ---------------------------------
// 2. DOM 元素
// ---------------------------------
let fileUploader, fileUploaderCompare, navLinks, modulePanels, welcomeScreen, compareUploadLabel;
let classFilterContainer, classFilterSelect, classFilterHr;
let modal, modalCloseBtn, modalSaveBtn, configSubjectsBtn, subjectConfigTableBody;
let echartsInstances = {};

document.addEventListener('DOMContentLoaded', () => {
    // 绑定 DOM 元素
    fileUploader = document.getElementById('file-uploader');
    fileUploaderCompare = document.getElementById('file-uploader-compare');
    navLinks = document.querySelectorAll('.nav-link');
    modulePanels = document.querySelectorAll('.module-panel');
    welcomeScreen = document.getElementById('welcome-screen');

    // 班级筛选
    classFilterContainer = document.getElementById('class-filter-container');
    classFilterSelect = document.getElementById('class-filter');
    classFilterHr = document.getElementById('class-filter-hr');

    // 科目配置
    modal = document.getElementById('subject-config-modal');
    modalCloseBtn = document.getElementById('modal-close-btn');
    modalSaveBtn = document.getElementById('modal-save-btn');
    configSubjectsBtn = document.getElementById('config-subjects-btn');
    subjectConfigTableBody = document.getElementById('subject-config-table').getElementsByTagName('tbody')[0];

    // 导入模态框 DOM
    const importModal = document.getElementById('import-modal');
    const importModalTitle = document.getElementById('import-modal-title');
    const importModalCloseBtn = document.getElementById('import-modal-close-btn');
    const importModalSelect = document.getElementById('import-modal-select');
    const importModalFromFileBtn = document.getElementById('import-modal-from-file');
    const importModalFromStorageBtn = document.getElementById('import-modal-from-storage');
    const importMainBtn = document.getElementById('import-main-btn'); 
    const importCompareBtn = document.getElementById('import-compare-btn'); 
    const clearAllBtn = document.getElementById('clear-all-data-btn'); //    (    )



    const printModal = document.getElementById('print-modal');
    const printModalCloseBtn = document.getElementById('print-modal-close-btn');
    const printBtnCurrent = document.getElementById('print-btn-current');
    const printBtnFilter = document.getElementById('print-btn-filter');

    // 初始化 UI
    initializeUI();
    initializeSubjectConfigs(); // 初始化科目配置
    loadDataFromStorage().catch(console.error);


    initAIModule();
    // 初始化历史记录 UI
    initAIHistoryUI();
    initMultiCollectionManager();

    // ---------------------------------
    // 3. 事件监听器
    // ---------------------------------

    // 监听文件上传 (本次成绩) 
    fileUploader.addEventListener('change', async (event) => {
        await handleFileData(event, 'main');
    });

    // 监听文件上传 (对比成绩) 
    fileUploaderCompare.addEventListener('change', async (event) => {
        await handleFileData(event, 'compare');
    });

    // 打开导入模态框
    importMainBtn.addEventListener('click', () => {
        G_CurrentImportType = 'main';
        importModalTitle.innerText = '选择“本次成绩”数据源';
        openImportModal();
    });

    // 打开导入模态框 (对比)
    importCompareBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('disabled')) return;
        G_CurrentImportType = 'compare';
        importModalTitle.innerText = '选择“对比成绩”数据源';
        openImportModal();
    });

    // 导入模态框：关闭
    importModalCloseBtn.addEventListener('click', () => {
        importModal.style.display = 'none';
    });

    // 导入模态框：从文件
    importModalFromFileBtn.addEventListener('click', () => {
        if (G_CurrentImportType === 'main') {
            fileUploader.click();
        } else if (G_CurrentImportType === 'compare') {
            fileUploaderCompare.click();
        } else if (G_CurrentImportType === 'goal-baseline') {
            // 触发目标模块的专用上传控件
            const input = document.getElementById('goal-upload-baseline');
            if (input) input.click();
        } else if (G_CurrentImportType === 'goal-outcome') {
            const input = document.getElementById('goal-upload-outcome');
            if (input) input.click();
        }
        importModal.style.display = 'none';
    });

    // 导入模态框：从存储
    // 导入模态框：从存储 (Data Center)
    importModalFromStorageBtn.addEventListener('click', async () => {
        const selectedId = importModalSelect.value;
        if (!selectedId) { alert('请选择一个已存的成绩单！'); return; }

        const allData = await loadMultiExamData();
        const selectedExam = allData.find(e => String(e.id) === selectedId);
        if (!selectedExam) { alert('未找到所选数据。'); return; }

        const labelText = `✅ ${selectedExam.label} (来自存储)`;

        // 2. 区分导入类型
        if (G_CurrentImportType === 'main') {
            // --- 导入到【本次成绩】 ---
            G_StudentsData = selectedExam.students;

            // (A) 重建科目列表
            if (G_StudentsData.length > 0) {
                const allSubjects = new Set();
                G_StudentsData.forEach(student => {
                    if (student.scores) {
                        Object.keys(student.scores).forEach(subject => allSubjects.add(subject));
                    }
                });
                if (allSubjects.size > 0) {
                    G_DynamicSubjectList = Array.from(allSubjects);
                }
            }



            // (B) 重建科目配置 (保留旧配置，添加  默认值)
            let storedConfigs = await localforage.getItem('G_SubjectConfigs');
            if (!storedConfigs) storedConfigs = {};

            G_SubjectConfigs = storedConfigs; // 更  内存

            G_DynamicSubjectList.forEach(subject => {
                if (!G_SubjectConfigs[subject]) {
                    const isY_S_W = ['语文', '数学', '英语'].includes(subject);
                    G_SubjectConfigs[subject] = {
                        full: isY_S_W ? 150 : 100,
                        superExcel: isY_S_W ? 135 : 90,
                        excel: isY_S_W ? 120 : 85,
                        good: isY_S_W ? 105 : 75,
                        pass: isY_S_W ? 90 : 60,
                        low: isY_S_W ? 45 : 30,
                        isAssigned: false
                    };
                }
            });

            // (C) 保存到 IndexedDB (localforage)
            console.log("正在将导入数据写入 IndexedDB...");
            await localforage.setItem('G_StudentsData', G_StudentsData);
            await localforage.setItem('G_MainFileName', selectedExam.label);
            await localforage.setItem('G_SubjectConfigs', G_SubjectConfigs); // 保存更  后的配置

            // (D) UI 刷  
            populateClassFilter(G_StudentsData);
            welcomeScreen.style.display = 'none';
            document.getElementById('import-compare-btn').classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';

            if (importMainBtn) importMainBtn.innerHTML = labelText;

            // UI 刷  
            populateClassFilter(G_StudentsData);
            welcomeScreen.style.display = 'none';
            document.getElementById('import-compare-btn').classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';
            if (importMainBtn) importMainBtn.innerHTML = labelText;
            runAnalysisAndRender();

        } else if (G_CurrentImportType === 'compare') {
            G_CompareData = selectedExam.students;
            await localforage.setItem('G_CompareData', G_CompareData);
            await localforage.setItem('G_CompareFileName', selectedExam.label);
            const compareBtn = document.getElementById('import-compare-btn');
            if (compareBtn) compareBtn.innerHTML = labelText;
            runAnalysisAndRender();

        } else if (G_CurrentImportType === 'goal-baseline') {
            // 目标模块 - 基准数据
            G_GoalBaselineData = selectedExam.students;
            // 如果全局定义了刷  函数，则调用它
            if (window.refreshGoalDataSourceUI) {
                window.refreshGoalDataSourceUI('baseline', selectedExam.label, G_GoalBaselineData);
            }
        } else if (G_CurrentImportType === 'goal-outcome') {
            // 目标模块 - 复盘数据
            G_GoalOutcomeData = selectedExam.students;
            if (window.refreshGoalDataSourceUI) {
                window.refreshGoalDataSourceUI('outcome', selectedExam.label, G_GoalOutcomeData);
            }
        }
        importModal.style.display = 'none';
        // 仅针对目标模块给个提示，主模块通常会自动刷  页面或图表
        if (G_CurrentImportType.startsWith('goal-')) {
            alert(`成功导入：${selectedExam.label}`);
        }
    });

    //    (    ) 监听“清除所有数据”按钮


    //    NEW (Print Feature)    打印模态框事件
    printModalCloseBtn.addEventListener('click', () => {
        printModal.style.display = 'none';
    });

    // (打印 "当前学生")
    printBtnCurrent.addEventListener('click', () => {
        const studentId = printBtnCurrent.dataset.studentId;
        if (studentId) {
            startPrintJob([studentId]); // 启动打印，只传一个学生ID
        }
        printModal.style.display = 'none';
    });

    // (打印 "当前筛选")
    printBtnFilter.addEventListener('click', () => {
        // 1. 获取当前筛选的学生列表
        let studentsToPrint = G_StudentsData;
        if (G_CurrentClassFilter !== 'ALL') {
            studentsToPrint = G_StudentsData.filter(s => s.class === G_CurrentClassFilter);
        }

        // 2. 提取他们的 ID
        const studentIds = studentsToPrint.map(s => s.id);
        if (studentIds.length > 0) {
            startPrintJob(studentIds); // 启动打印
        }
        printModal.style.display = 'none';
    });



    //    核心修复    “清除所有数据”按钮逻辑升级
    // 必须同时清除 localStorage (旧) 和 localforage (  数据库)
    clearAllBtn.addEventListener('click', async () => {
        if (confirm("⚠️ 高能预警\n\n您确定要清除所有已导入的“本次成绩”和“对比成绩”吗？\n此操作不可恢复！\n\n(注意：此操作【不会】清除“数据管理中心”中的历史存档)")) {

            // 给按钮一点反馈
            const originalText = clearAllBtn.innerHTML;
            clearAllBtn.innerText = "🧹 正在强力清理...";
            clearAllBtn.disabled = true;

            try {
                // 1. [关键] 清除 IndexedDB 中的核心数据
                await Promise.all([
                    localforage.removeItem('G_StudentsData'),
                    localforage.removeItem('G_CompareData'),
                    localforage.removeItem('G_MainFileName'),
                    localforage.removeItem('G_CompareFileName'),
                    localforage.removeItem('G_SubjectConfigs'),
                    // 建议同时也清除小题分析的缓存，防止数据不匹配
                    localforage.removeItem('G_ItemAnalysisData'),
                    localforage.removeItem('G_ItemAnalysisConfig'),
                    localforage.removeItem('G_ItemAnalysisFileName')
                ]);

                // 2. 清除 localStorage (清理旧的残留数据)
                localStorage.removeItem('G_StudentsData');
                localStorage.removeItem('G_CompareData');
                localStorage.removeItem('G_MainFileName');
                localStorage.removeItem('G_CompareFileName');
                localStorage.removeItem('G_SubjectConfigs');
                localStorage.removeItem('G_ItemAnalysisData');
                localStorage.removeItem('G_ItemAnalysisConfig');

                // 3. 刷  页面
                alert("✅ 数据已彻底清除，系统即将重启。");
                location.reload();

            } catch (err) {
                console.error("清除失败:", err);
                alert("❌ 清除过程中出现错误，请尝试手动清除浏览器缓存。");
                clearAllBtn.innerText = originalText;
                clearAllBtn.disabled = false;
            }
        }
    });


    // 监听导航切换
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            //      先获取模块名
            const targetModule = link.getAttribute('data-module');

            //      如果不是“多次考试分析”模块，才检查 disabled
            if (targetModule !== 'multi-exam' && link.classList.contains('disabled')) {
                alert('请先导入本次成绩数据！');
                return;
            }
            // const targetModule = link.getAttribute('data-module'); // (已移到前面)

            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            runAnalysisAndRender();
        });
    });

    // 班级筛选
    classFilterSelect.addEventListener('change', () => {
        G_CurrentClassFilter = classFilterSelect.value;
        runAnalysisAndRender();
    });

    // 科目配置模态窗
    configSubjectsBtn.addEventListener('click', () => {
        populateSubjectConfigModal();
        modal.style.display = 'flex';
    });
    modalCloseBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    modalSaveBtn.addEventListener('click', () => {
        saveSubjectConfigsFromModal();
        modal.style.display = 'none';
        runAnalysisAndRender();
    });

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        for (const key in echartsInstances) {
            if (echartsInstances[key]) {
                echartsInstances[key].resize();
            }
        }
    });


    // --- 暗黑模式逻辑 ---
    const themeBtn = document.getElementById('theme-toggle-btn');
    const currentTheme = localStorage.getItem('app_theme') || 'light';

    // 初始化主题
    if (currentTheme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    }

    themeBtn.addEventListener('click', () => {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('app_theme', 'light');
        } else {
            document.body.setAttribute('data-theme', 'dark');
            localStorage.setItem('app_theme', 'dark');
        }

        // [可选] 如果需要 ECharts 也切换深色主题，这里需要调用 runAnalysisAndRender() 重绘
        runAnalysisAndRender();
    });
});

/**
 * 4. UI 初始化
 * 禁用所有操作，直到主文件被加载
 */
//    MODIFIED   
function initializeUI() {
    document.getElementById('import-compare-btn').classList.add('disabled');
    navLinks.forEach(link => {
        //      允许“多次考试分析”和“小题分析”模块始终可用
        const module = link.getAttribute('data-module');
        if (module === 'multi-exam' || module === 'item-analysis') { //    MODIFIED   
            link.classList.remove('disabled'); // 确保它绝不被禁用
        } else if (!link.classList.contains('active')) {
            link.classList.add('disabled');
        }
    });
}

/**
 * 文件处理函数 (包含写入验证)
 */
async function handleFileData(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    const label = (type === 'main') ?
        document.getElementById('import-main-btn') :
        document.getElementById('import-compare-btn');
    const statusLabel = label || event.target.previousElementSibling;
    if (statusLabel) statusLabel.innerHTML = "🔄 正在解析...";

    try {
        // 1. 解析
        const { processedData, dynamicSubjectList } = await loadExcelData(file);

        // 2. 预处理
        if (type === 'main') {
            G_DynamicSubjectList = dynamicSubjectList;
            initializeSubjectConfigs();
            // 保存配置
            await localforage.setItem('G_SubjectConfigs', G_SubjectConfigs);
        }
        const rankedData = addSubjectRanksToData(processedData);

        // 3. 保存到 IndexedDB
        const key = (type === 'main') ? 'G_StudentsData' : 'G_CompareData';
        const fileKey = (type === 'main') ? 'G_MainFileName' : 'G_CompareFileName';

        if (type === 'main') G_StudentsData = rankedData;
        else G_CompareData = rankedData;

        console.log(`正在保存 ${key} (${rankedData.length}条数据)...`);

        try {
            await localforage.setItem(key, rankedData);
            await localforage.setItem(fileKey, file.name);
        } catch (saveErr) {
            console.warn("直接保存失败，尝试转换为 JSON 字符串保存...", saveErr);
            // 降级方案：转字符串存 (牺牲一点性能换取成功率)
            await localforage.setItem(key, JSON.stringify(rankedData));
            await localforage.setItem(fileKey, file.name);
        }

        // 4. 立即读取验证
        const check = await localforage.getItem(key);
        if (!check || (typeof check !== 'string' && check.length !== rankedData.length)) {
            throw new Error("严重错误：数据写入校验失败！请检查浏览器磁盘空间。");
        }
        console.log("✅ 数据写入并校验成功！");

        // 5. UI 刷  逻辑
        if (type === 'main') {
            populateClassFilter(G_StudentsData);
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            document.getElementById('import-compare-btn').classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';
            runAnalysisAndRender();
        }

        if (statusLabel) statusLabel.innerHTML = `✅ ${file.name} (已加载)`;
        event.target.value = '';

    } catch (err) {
        console.error(err);
        if (statusLabel) statusLabel.innerHTML = `❌ 失败`;
        alert(`保存失败：${err.message}\n建议：如果是超大文件，请尝试拆分或使用模块12导入。`);
        event.target.value = '';
    }
}


/**
 * 6.1 读取 Excel/CSV 文件 (智能解析器 - 动态识别表头行和科目)
 *
 * @param {File} file - 用户上传的Excel或CSV文件对象。
 * @returns {Promise<Object>} - 包含 { processedData, dynamicSubjectList } 的对象。
 */
function loadExcelData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // 1. 读取工作簿
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];

                const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                if (rawData.length < 2) { //   至少需要1行表头和1行数据
                    return reject(new Error("文件数据不完整，至少需要1行表头和1行数据。"));
                }

                // --- 🚀 智能定位表头行   ---
                let keyRowIndex = -1;
                //      我们只依赖 "姓名" 和 "班级"
                const REQUIRED_METRICS = ["姓名", "班级"];

                // 遍历原始数据的前几行（最多前5行）
                for (let i = 0; i < Math.min(rawData.length, 5); i++) {
                    const row = rawData[i].map(String).map(s => s.trim());
                    const foundCount = REQUIRED_METRICS.filter(metric => row.includes(metric)).length;

                    //      只要 "姓名" 和 "班级" 都在，就认定是关键行
                    if (foundCount === 2) {
                        keyRowIndex = i;
                        break;
                    }
                }

                if (keyRowIndex === -1) {
                    //      更  错误提示
                    return reject(new Error("无法自动识别指标行。请确保表头包含 '姓名' 和 '班级' 字段。"));
                }

                // 确定科目行（关键行的上一行）和数据开始行
                const subjectRowIndex = keyRowIndex - 1;
                const studentDataStartRow = keyRowIndex + 1;

                // 科目行：可能存在（两级表头）或不存在（一级表头或大标题）
                const subjectHeader = (subjectRowIndex >= 0) ?
                    rawData[subjectRowIndex].map(String).map(s => s.trim()) :
                    [];
                // 关键行
                const keyHeader = rawData[keyRowIndex].map(String).map(s => s.trim());
                // --- 🚀 智能定位表头行 END ---


                const colMap = {};
                let currentSubject = ""; // (用于两级表头)
                const headerLength = keyHeader.length;
                const dynamicSubjectList = [];

                //      2. 核心：动态构建列映射 (colMap)
                for (let i = 0; i < headerLength; i++) {
                    const subject = String(subjectHeader[i] || "").trim(); // 科目行
                    const key = keyHeader[i]; // 关键行

                    // A. 识别固定字段 (基于 关键行 key)
                    if (key === "自定义考号") { colMap[i] = "id"; continue; }
                    if (key === "姓名") { colMap[i] = "name"; continue; }
                    if (key === "班级") { colMap[i] = "class"; continue; }
                    if (key === "班次") { colMap[i] = "rank"; continue; }
                    if (key === "校次") { colMap[i] = "gradeRank"; continue; }

                    // B. 追踪科目名 (基于 科目行 subject)
                    if (subject !== "") {
                        currentSubject = subject;
                    }

                    // C. 识别总分
                    // (Case 1: 两级表头 - subject="总分", key="得分")
                    if (currentSubject === "总分" && key === "得分") {
                        colMap[i] = "totalScore";
                    }
                    // (Case 2: 一级表头 - key="总分")
                    else if (key === "总分") {
                        colMap[i] = "totalScore";
                    }

                    // D. 识别各科得分
                    // (Case 1: 两级表头 - subject="语文", key="得分")
                    else if (key === "得分" && currentSubject !== "" && currentSubject !== "总分") {
                        colMap[i] = `scores.${currentSubject}`;
                        if (!dynamicSubjectList.includes(currentSubject)) {
                            dynamicSubjectList.push(currentSubject);
                        }
                    }
                    // (Case 2: 一级表头 - key="语文")
                    // (我们排除所有已知的非科目关键字)
                    else if (key !== "" &&
                        !["自定义考号", "姓名", "班级", "班次", "校次", "得分", "准考证号", "学生属性", "序号", "校次进退步", "班次进退步"].includes(key) && //      在这里添加 "准考证号"
                        !key.includes("总分")) {
                        // (此时 subjectHeader 可能是空的, key 是 "语文")
                        const subjectName = key;
                        colMap[i] = `scores.${subjectName}`;
                        if (!dynamicSubjectList.includes(subjectName)) {
                            dynamicSubjectList.push(subjectName);
                        }
                    }
                }

                // 3. 校验关键字段
                //      只要求 "name" 和 "class"
                const requiredKeys = ["name", "class"];
                const foundKeys = Object.values(colMap);
                const missingKeys = requiredKeys.filter(key => !foundKeys.includes(key));

                if (missingKeys.length > 0) {
                    //      更  错误提示
                    return reject(new Error(`无法自动解析表头。文件缺少关键字段: ${missingKeys.join(', ')}。请确保表头包含 '姓名' 和 '班级'。`));
                }

                // 4. 处理数据行
                const studentRows = rawData.slice(studentDataStartRow);
                const processedData = [];

                for (const row of studentRows) {
                    if (!String(row[Object.keys(colMap)[0]] || "").trim() && !String(row[Object.keys(colMap)[1]] || "").trim()) continue;

                    const student = { scores: {} };

                    for (const colIndex in colMap) {
                        const key = colMap[colIndex];
                        const rawValue = row[colIndex];

                        if (key.startsWith("scores.")) {
                            const subjectName = key.split('.')[1];
                            const cleanScore = parseFloat(rawValue);
                            student.scores[subjectName] = isNaN(cleanScore) ? null : cleanScore;
                        } else if (key === "totalScore") {
                            const cleanTotal = parseFloat(rawValue);
                            student.totalScore = isNaN(cleanTotal) ? null : cleanTotal;
                        } else if (key === "rank" || key === "gradeRank") {
                            const cleanRank = parseInt(rawValue);
                            //      缺失的排名设为 null, 以便触发自动计算
                            student[key] = isNaN(cleanRank) ? null : cleanRank;
                        } else {
                            student[key] = String(rawValue || "").trim();
                        }
                    }

                    //      自动计算总分 (始终覆盖)
                    // if (student.totalScore === undefined || student.totalScore === null) { // <-- 删除这一行
                    let calculatedTotal = 0;
                    let hasValidScores = false;

                    for (const subject of dynamicSubjectList) {
                        const score = student.scores[subject];
                        if (typeof score === 'number' && !isNaN(score)) {
                            calculatedTotal += score;
                            hasValidScores = true;
                        }
                    }
                    student.totalScore = hasValidScores ? parseFloat(calculatedTotal.toFixed(2)) : null;
                    // } // <-- 删除这一行

                    //    (    ) ID回退
                    if (!student.id && student.name) {
                        student.id = student.name;
                    }

                    if (student.id) {
                        processedData.push(student);
                    }
                }

                if (processedData.length === 0) {
                    return reject(new Error("文件解析成功，但没有找到有效的学生数据行。"));
                }

                resolve({ processedData: processedData, dynamicSubjectList: dynamicSubjectList });

            } catch (err) {
                console.error(err);
                reject(new Error("文件解析失败: ".concat(err.message || "未知错误。")));
            }
        };
        reader.onerror = (err) => reject(new Error("文件读取失败: ".concat(err)));
        reader.readAsArrayBuffer(file);
    });
}
/**
 *   6.2. 为数据添加单科排名
 * (总分排名 'rank' 和 'gradeRank' 已经从Excel读取)
 * @param {Array<Object>} studentsData
 * @returns {Array<Object>}
 */
/**
 *   6.2.    为数据添加单科排名 (班排 & 年排)
 */
function addSubjectRanksToData(studentsData) {
    if (!studentsData || studentsData.length === 0) return [];

    const dataWithRanks = [...studentsData];
    const classes = [...new Set(dataWithRanks.map(s => s.class))];

    // 1. 动态扫描所有出现的科目 (防止全局列表缺失)
    const allSubjects = new Set();
    // 如果有全局列表，先加入
    if (typeof G_DynamicSubjectList !== 'undefined') {
        G_DynamicSubjectList.forEach(s => allSubjects.add(s));
    }
    // 扫描数据中的科目
    dataWithRanks.forEach(s => {
        if (s.scores) Object.keys(s.scores).forEach(k => allSubjects.add(k));
    });
    const subjectList = Array.from(allSubjects);

    // 2. 计算 年级总分排名 (如果缺失)
    if (!dataWithRanks[0].gradeRank) {
        dataWithRanks.sort((a, b) => (b.totalScore || -Infinity) - (a.totalScore || -Infinity));
        dataWithRanks.forEach((student, index) => { student.gradeRank = index + 1; });
    }

    // 3. 计算 班级总分排名 (如果缺失)
    if (!dataWithRanks[0].rank) {
        classes.forEach(className => {
            const classStudents = dataWithRanks.filter(s => s.class === className);
            classStudents.sort((a, b) => (b.totalScore || -Infinity) - (a.totalScore || -Infinity));
            classStudents.forEach((student, index) => { student.rank = index + 1; });
        });
    }

    // 4. [核心] 计算单科排名 (年级 & 班级)
    subjectList.forEach(subjectName => {
        // A. 年级科目排名
        // 过滤出该科有分数的学生进行排序 (从高到低)
        // 注意：我们对所有学生计算排名，缺考(null/undefined)的排在最后或不参与
        // 这里采用: 有分数的参与排名，无分数的 rank=null
        const validStudents = dataWithRanks.filter(s => typeof s.scores[subjectName] === 'number');
        
        validStudents.sort((a, b) => b.scores[subjectName] - a.scores[subjectName]);

        validStudents.forEach((student, index) => {
            if (!student.gradeRanks) student.gradeRanks = {};
            // 处理同分排名 (可选: 相同分数排名相同) -> 这里简化为序号
            student.gradeRanks[subjectName] = index + 1;
        });

        // B. 班级科目排名
        classes.forEach(className => {
            const classStudents = validStudents.filter(s => s.class === className);
            // 已经在上面按分数排过序了，这里再次过滤就是有序的吗？
            // 为了保险，再次排序
            classStudents.sort((a, b) => b.scores[subjectName] - a.scores[subjectName]);
            
            classStudents.forEach((student, index) => {
                if (!student.classRanks) student.classRanks = {};
                student.classRanks[subjectName] = index + 1;
            });
        });
    });

    // 5. 恢复默认排序 (按班级总分排名)
    return dataWithRanks.sort((a, b) => a.rank - b.rank);
}


/**
 *   6.3. 计算所有统计数据
 * @param {Array<Object>} studentsData (这是 *已筛选* 后的数据)
 * @returns {Object}
 */
function calculateAllStatistics(studentsData) {
    if (!studentsData || studentsData.length === 0) return {};

    const stats = {};

    // 1. 统计所有科目 (从 G_SubjectConfigs 读取配置)
    //    (    ) totalGood
    let totalFull = 0, totalPass = 0, totalExcel = 0, totalGood = 0;

    G_DynamicSubjectList.forEach(subjectName => {
        const config = G_SubjectConfigs[subjectName];
        if (!config) return; // 如果配置不存在，跳过

        const subjectScores = studentsData
            .map(s => s.scores[subjectName])
            .filter(score => typeof score === 'number' && !isNaN(score))
            .sort((a, b) => a - b);

        //      传入 config.good
        stats[subjectName] = calculateStatsForScores(
            subjectScores,
            config.full,
            config.pass,
            config.excel,
            config.good,
            config.superExcel || (config.full * 0.9), // 传入特优
            config.low || (config.full * 0.3)         // 传入低分
        );
        stats[subjectName].name = subjectName;

        // 累加总分配置
        totalFull += config.full;
        totalPass += config.pass;
        totalExcel += config.excel;
        totalGood += config.good; //    (    )
    });

    // 2. 统计 '总分' (totalScore)
    const totalScores = studentsData.map(s => s.totalScore).filter(score => typeof score === 'number' && !isNaN(score)).sort((a, b) => a - b);
    //      传入 totalGood
    stats['totalScore'] = calculateStatsForScores(totalScores, totalFull, totalPass, totalExcel, totalGood);
    stats['totalScore'].name = '总分';

    return stats;
}


/**
 * [    ] 1. 计算标准分 (Z-Score / T-Score)
 * Z = (分数 - 平均分) / 标准差
 * T = 50 + 10 * Z (标准 T 分，平均50，标准差10)
 * 同时注入到学生对象中：student.zScores 和 student.tScores
 */
function calculateStandardScores(students, stats) {
    students.forEach(student => {
        student.tScores = {}; // 存储 T 分
        student.zScores = {}; // 存储 Z 分

        G_DynamicSubjectList.forEach(subject => {
            const stat = stats[subject];
            const score = student.scores[subject];

            if (stat && stat.stdDev > 0 && typeof score === 'number') {
                const z = (score - stat.average) / stat.stdDev;
                const t = 50 + (10 * z);

                student.zScores[subject] = parseFloat(z.toFixed(2));
                student.tScores[subject] = parseFloat(t.toFixed(1)); // T分通常保留1位
            } else {
                student.zScores[subject] = 0;
                student.tScores[subject] = 50; // 默认平均水平
            }
        });
    });
}

/**
 * [    ] 2.   高考赋分制预估 (简易版 - 21等级赋分)
 * 基于排位百分比映射到 100-30 分
 */
function calculateAssignedScore(rank, totalCount) {
    if (!totalCount) return 0;
    const percentage = (rank / totalCount) * 100;

    // 典型  高考赋分区间 (可根据省份政策调整)
    // 前1% -> 100, 1-3% -> 97 ... 
    if (percentage <= 1) return 100;
    if (percentage <= 3) return 97;
    if (percentage <= 6) return 94;
    if (percentage <= 10) return 91;
    if (percentage <= 15) return 88;
    if (percentage <= 21) return 85;
    if (percentage <= 28) return 82;
    if (percentage <= 36) return 79;
    if (percentage <= 45) return 76;
    if (percentage <= 55) return 73;
    if (percentage <= 66) return 70;
    if (percentage <= 78) return 67;
    if (percentage <= 91) return 64;
    if (percentage <= 97) return 61;
    if (percentage <= 99) return 58; // E等级区间
    return 40; // 最低保底
}

/**
 * [    ] 福建省  高考赋分算法 (3+1+2模式 - 再选科目)
 * 规则：
 * A等级: 15%, 100-86
 * B等级: 35%, 85-71
 * C等级: 35%, 70-56
 * D等级: 13%, 55-41
 * E等级: 2%,  40-30
 * 公式: (Y2-Y)/(Y-Y1) = (T2-X)/(X-T1)  =>  X = ( (Y-Y1)/(Y2-Y1) ) * (T2-T1) + T1
 */
function calculateFujianAssignedScore(studentScore, allScores) {
    // 1. 数据清洗与排序 (从高到低)
    const validScores = allScores.filter(s => typeof s === 'number' && !isNaN(s)).sort((a, b) => b - a);
    const total = validScores.length;

    if (total === 0 || typeof studentScore !== 'number') return 'N/A';

    // 2. 确定各个等级的人数截止位次 (向下取整)
    // 注意：这里简化处理，严格场景下如同分需扩展区间
    const idxA = Math.floor(total * 0.15);          // A等级截止索引
    const idxB = Math.floor(total * (0.15 + 0.35)); // B等级截止索引 (50%)
    const idxC = Math.floor(total * (0.50 + 0.35)); // C等级截止索引 (85%)
    const idxD = Math.floor(total * (0.85 + 0.13)); // D等级截止索引 (98%)
    // 剩余为 E等级

    // 3. 确定考生所在的等级区间
    const myRankIdx = validScores.indexOf(studentScore); // 获取该分数的最高排名索引

    let T1, T2, Y1, Y2;
    let subset = [];

    if (myRankIdx < idxA) {
        // A等级
        T2 = 100; T1 = 86;
        subset = validScores.slice(0, idxA);
    } else if (myRankIdx < idxB) {
        // B等级
        T2 = 85; T1 = 71;
        subset = validScores.slice(idxA, idxB);
    } else if (myRankIdx < idxC) {
        // C等级
        T2 = 70; T1 = 56;
        subset = validScores.slice(idxB, idxC);
    } else if (myRankIdx < idxD) {
        // D等级
        T2 = 55; T1 = 41;
        subset = validScores.slice(idxC, idxD);
    } else {
        // E等级
        T2 = 40; T1 = 30;
        subset = validScores.slice(idxD);
    }

    // 4. 获取该等级原始分的最高值(Y2)和最低值(Y1)
    if (subset.length === 0) return studentScore; // 异常保护
    Y2 = subset[0]; // 区间最高原始分
    Y1 = subset[subset.length - 1]; // 区间最低原始分

    // 5. 代入公式计算
    // 特殊情况：如果该区间只有一个分数(Y1=Y2)，直接给满分或平均分？通常给 T2
    if (Y2 === Y1) return T2;

    // 线性插值公式
    const assignedScore = ((studentScore - Y1) / (Y2 - Y1)) * (T2 - T1) + T1;

    return Math.round(assignedScore); // 四舍五入取整
}

/**
 *   6.4. 辅助函数：计算单个分数数组的统计值
 *        加了 superExcelLine (特优线) 和 lowLine (低分线) 参数
 */
function calculateStatsForScores(scores, fullMark, passLine, excellentLine, goodLine, superExcelLine, lowLine) {
    const count = scores.length;

    //    默认值保护：如果未定义，给一个默认值防止报错
    if (superExcelLine === undefined) superExcelLine = fullMark * 0.9;
    if (lowLine === undefined) lowLine = passLine * 0.5;

    if (count === 0) return { average: 0, max: 0, min: 0, median: 0, passRate: 0, excellentRate: 0, goodRate: 0, failRate: 0, superRate: 0, lowRate: 0, count: 0, variance: 0, stdDev: 0, difficulty: 0, scores: [] };

    const total = scores.reduce((acc, score) => acc + score, 0);
    const average = total / count;
    const max = scores[count - 1];
    const min = scores[0];

    const mid = Math.floor(count / 2);
    const median = count % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];

    const variance = (count > 0) ? scores.reduce((acc, score) => acc + Math.pow(score - average, 2), 0) / count : 0;
    const stdDev = (count > 0) ? Math.sqrt(variance) : 0;

    const difficulty = (fullMark > 0) ? parseFloat((average / fullMark).toFixed(2)) : 0;

    const passCount = scores.filter(s => s >= passLine).length;
    const excellentCount = scores.filter(s => s >= excellentLine).length;

    // (B) - B (良好) = [goodLine, excelLine)
    const countB = scores.filter(s => s >= goodLine && s < excellentLine).length;
    // (D) - D (不及格) = < passLine
    const countD = scores.filter(s => s < passLine).length;

    // (C) - C (及格) = [passLine, goodLine)
    const countC = scores.filter(s => s >= passLine && s < goodLine).length;
    const cRate = (count > 0) ? (countC / count) * 100 : 0;

    // 良好率 (B级率)
    const goodRate = (count > 0) ? (countB / count) * 100 : 0;
    // 不及格率 (D级率)
    const failRate = (count > 0) ? (countD / count) * 100 : 0;

    //    (    ) 特优率 (Super Excellent)
    const countSuper = scores.filter(s => s >= superExcelLine).length;
    const superRate = (count > 0) ? (countSuper / count) * 100 : 0;

    //    (    ) 低分率 (Low Score)
    const countLow = scores.filter(s => s < lowLine).length;
    const lowRate = (count > 0) ? (countLow / count) * 100 : 0;

    return {
        count: count,
        average: parseFloat(average.toFixed(2)),
        max: max,
        min: min,
        median: median,
        passRate: parseFloat(((passCount / count) * 100).toFixed(2)),
        excellentRate: parseFloat(((excellentCount / count) * 100).toFixed(2)),
        goodRate: parseFloat(goodRate.toFixed(2)),
        cRate: parseFloat(cRate.toFixed(2)),
        failRate: parseFloat(failRate.toFixed(2)),

        //        返回指标
        superRate: parseFloat(superRate.toFixed(2)),
        lowRate: parseFloat(lowRate.toFixed(2)),

        variance: parseFloat(variance.toFixed(2)),
        stdDev: parseFloat(stdDev.toFixed(2)),
        difficulty: difficulty,
        scores: scores
    };
}

// ---------------------------------
// 7. 模块渲染 (Routing)
// ---------------------------------

/**
 * (    ) 7.1. 核心分析与渲染触发器
 *       允许 multi-exam 模块在没有 G_StudentsData 时运行
 */
function runAnalysisAndRender() {
    // 1.      先获取当前要渲染的模块
    const currentModuleLink = document.querySelector('.nav-link.active');
    if (!currentModuleLink) return;
    const currentModule = currentModuleLink.dataset.module;

    // 2.      如果是“多次考试分析”或“小题分析”，则特殊处理
    if (currentModule === 'multi-exam') {
        renderModule(currentModule, [], []);
        return;
    }
    //    NEW   
    if (currentModule === 'item-analysis') {
        renderModule(currentModule, [], []);
        return;
    }

    // 3.    (原第1行) 对所有其他模块，执行数据检查
    if (G_StudentsData.length === 0) {
        console.warn("runAnalysisAndRender: G_StudentsData 为空，已退出。");
        return;
    }

    // 4. (    ) 根据班级筛选
    const currentFilter = classFilterSelect.value;
    let activeData = G_StudentsData;
    let activeCompareData = G_CompareData;

    if (currentFilter !== 'ALL') {
        activeData = G_StudentsData.filter(s => s.class === currentFilter);

        if (G_CompareData.length > 0) {
            activeCompareData = G_CompareData.filter(s => s.class === currentFilter);
        }
    }

    // 5.   重  计算统计数据
    G_Statistics = calculateAllStatistics(activeData);
    calculateStandardScores(activeData, G_Statistics);
    if (activeCompareData.length > 0) {
        G_CompareStatistics = calculateAllStatistics(activeCompareData);

        calculateStandardScores(activeCompareData, G_CompareStatistics); // <-- 关键：这一行之前漏了
    }

    // 6.   渲染当前激活的模块
    // (currentModule 已在最前面获取)
    renderModule(currentModule, activeData, activeCompareData);
}

/**
 *   7.2. 模块渲染的“路由器”
 *    已     case 'weakness'
 */
function renderModule(moduleName, activeData, activeCompareData) {
    //    (    ) 渲染任何模块时，都自动隐藏欢迎屏幕
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    modulePanels.forEach(p => p.style.display = 'none');
    const container = document.getElementById(`module-${moduleName}`);
    if (!container) return;
    container.style.display = 'block';

    //   G_Statistics 已经是算好的
    switch (moduleName) {
        case 'dashboard':
            renderDashboard(container, G_Statistics, activeData);
            break;
        case 'student':
            renderStudent(container, activeData, G_Statistics);
            break;
        case 'paper':
            renderPaper(container, G_Statistics, activeData);
            break;
        case 'single-subject':
            renderSingleSubject(container, activeData, G_Statistics);
            break;

        //    (    ) 3个  模块的路由
        case 'boundary':
            renderBoundary(container, activeData, G_Statistics);
            break;
        case 'holistic':
            renderHolisticBalance(container, activeData, G_Statistics);
            break;
        case 'trend-distribution':
            renderTrendDistribution(container, activeData, activeCompareData, G_Statistics, G_CompareStatistics, G_CurrentClassFilter); //    (    ) 传入 G_CurrentClassFilter
            break;
        case 'multi-exam':
            renderMultiExam(container);
            break;
        case 'trend':
            renderTrend(container, activeData, activeCompareData);
            break;
        case 'groups':
            renderGroups(container, activeData);
            break;
        case 'correlation':
            renderCorrelation(container, activeData);
            break;
        //    (    ) 偏科诊断
        case 'weakness':
            renderWeakness(container, activeData, G_Statistics); //    (    ) 传入 G_Statistics
            break;
        //小题分析
        case 'item-analysis':
            renderItemAnalysis(container);
            break;

        case 'ai-advisor':
            //    修复    每次进入 AI 模块时，强制刷  一下 UI
            // 这样你在模块 13 刚导入的数据，这里也能立马看到了
            const aiModeSelect = document.getElementById('ai-mode-select');
            if (aiModeSelect) {
                // 模拟用户“切换”了一次模式，触发数据重  加载
                aiModeSelect.dispatchEvent(new Event('change'));
            }
            break;

        case 'goal-setting':
            renderGoalSetting(container, activeData, G_Statistics);
            break;

        //    在这里插入这一段   
        case 'exam-arrangement':
            renderExamArrangement(container);
            break;

        //            智能互助分组
        case 'study-groups':
            renderStudyGroups(container);
            break;

        case 'comment-gen':
            renderCommentGenerator(container);
            break;

        //            错题攻坚本
        case 'weakness-workbook':
            renderWeaknessWorkbook(container);
            break;

        case 'honor':
            renderHonorWall(container);
            break;

        default:
            container.innerHTML = `<h2>模块 ${moduleName} (待开发)</h2>`;
    }
}

/**
 * (    ) 7.3. 填充班级筛选
 */
function populateClassFilter(students) {
    const classes = [...new Set(students.map(s => s.class))].sort();

    let html = `<option value="ALL">-- 全体年段 --</option>`;
    html += classes.map(c => `<option value="${c}">${c}</option>`).join('');

    classFilterSelect.innerHTML = html;
    G_CurrentClassFilter = 'ALL';
}

// ---------------------------------
// 8. 科目配置 (Modal)
// ---------------------------------

/**
 * (    ) 8.1. 初始化 G_SubjectConfigs
 */
function initializeSubjectConfigs() {
    G_SubjectConfigs = {};
    G_DynamicSubjectList.forEach(subject => {
        const isY_S_W = ['语文', '数学', '英语'].includes(subject);

        G_SubjectConfigs[subject] = {
            full: isY_S_W ? 150 : 100,
            superExcel: isY_S_W ? 135 : 90,
            excel: isY_S_W ? 120 : 85,
            good: isY_S_W ? 105 : 75,
            pass: isY_S_W ? 90 : 60,
            low: isY_S_W ? 45 : 30,
            isAssigned: false //            默认为不赋分
        };
    });
}

/**
 * (    ) 8.2. 用 G_SubjectConfigs 填充模态窗口 (修复版：自动补全默认值)
 */


/**
 * (    ) 8.2. 用 G_SubjectConfigs 填充模态窗口
 *    修正版 3      加“是否赋分”列
 */
function populateSubjectConfigModal() {
    let html = '';
    G_DynamicSubjectList.forEach(subject => {
        const config = G_SubjectConfigs[subject];

        const valSuper = config.superExcel !== undefined ? config.superExcel : (config.full * 0.9);
        const valLow = config.low !== undefined ? config.low : (config.full * 0.3);

        //            读取是否赋分 (默认 false)
        const isAssigned = config.isAssigned === true;

        html += `
            <tr>
                <td><strong>${subject}</strong></td>
                <td style="text-align:center;">
                    <input type="checkbox" data-subject="${subject}" data-type="isAssigned" ${isAssigned ? 'checked' : ''} style="width:auto;">
                </td>
                <td><input type="number" data-subject="${subject}" data-type="full" value="${config.full}" style="width:50px"></td>
                <td><input type="number" data-subject="${subject}" data-type="superExcel" value="${valSuper}" style="width:50px; color:#6f42c1; font-weight:bold;"></td>
                <td><input type="number" data-subject="${subject}" data-type="excel" value="${config.excel}" style="width:50px"></td>
                <td><input type="number" data-subject="${subject}" data-type="good" value="${config.good}" style="width:50px"></td>
                <td><input type="number" data-subject="${subject}" data-type="pass" value="${config.pass}" style="width:50px"></td>
                <td><input type="number" data-subject="${subject}" data-type="low" value="${valLow}" style="width:50px; color:#dc3545;"></td>
            </tr>
        `;
    });

    const tableHead = document.querySelector('#subject-config-table thead');
    tableHead.innerHTML = `
        <tr>
            <th>科目</th>
            <th>赋分?</th> <th>满分</th>
            <th style="color:#6f42c1">特优线</th>
            <th>优秀线</th>
            <th>良好线</th>
            <th>及格线</th>
            <th style="color:#dc3545">低分线</th>
        </tr>
    `;

    subjectConfigTableBody.innerHTML = html;
}

/**
 * (    ) 8.3. 从模态窗口保存配置
 *    终极修复版    专门处理 Checkbox 的保存逻辑
 */
function saveSubjectConfigsFromModal() {
    // 获取表格里所有的 input 标签
    const inputs = subjectConfigTableBody.querySelectorAll('input');

    inputs.forEach(input => {
        const subject = input.dataset.subject;
        const type = input.dataset.type; 

        
        if (!G_SubjectConfigs[subject]) {
            G_SubjectConfigs[subject] = {};
        }

        
        if (input.type === 'checkbox') {
            
            G_SubjectConfigs[subject][type] = input.checked;
            console.log(`更   ${subject} 的赋分状态: ${input.checked}`); // 调试日志
        } else {
            // 如果是数字框，我们要存的是数字 (value属性)
            G_SubjectConfigs[subject][type] = parseFloat(input.value);
        }
    });

    // 保存到数据库
    localforage.setItem('G_SubjectConfigs', G_SubjectConfigs).then(() => {
        console.log("配置已成功保存至 IndexedDB");
        alert("配置已保存！"); // [提示] 加个弹窗确认保存成功
    });
}


// ---------------------------------
// 9. 各模块具体实现
// ---------------------------------
/**
/**
/**
 * 9.1. [完整修复版] 模块一：班级整体分析
 * - 修复：ReferenceError: drawHistogram is not defined
 * - 优化：调整函数定义顺序，确保所有图表函数在调用前已定义
 */
function renderDashboard(container, stats, activeData) {
    const totalStats = stats.totalScore || {};

    // 1. 计算基础 KPI
    const totalStudentCount = activeData.length;
    const participantCount = totalStats.count || 0;
    const missingCount = totalStudentCount - participantCount;

    // [动态表格状态]
    let currentSelectedSubjects = [...G_DynamicSubjectList];

    // 2. 构建 HTML 结构
    container.innerHTML = `
        <h2>模块一：整体成绩分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="kpi-grid">
            <div class="kpi-card"><h3>总人数</h3><div class="value">${totalStudentCount}</div></div>
            <div class="kpi-card"><h3>考试人数</h3><div class="value">${participantCount}</div></div>
            <div class="kpi-card"><h3>缺考人数</h3><div class="value">${missingCount}</div></div>
            <div class="kpi-card"><h3>原始总分均分</h3><div class="value">${totalStats.average || 0}</div></div>
            <div class="kpi-card"><h3>原始总分最高</h3><div class="value">${totalStats.max || 0}</div></div>
            <div class="kpi-card"><h3>原始总分最低</h3><div class="value">${totalStats.min || 0}</div></div>
            <div class="kpi-card"><h3>总分中位数</h3><div class="value">${totalStats.median || 0}</div></div>
            <div class="kpi-card"><h3>总分优秀率 (%)</h3><div class="value">${totalStats.excellentRate || 0}</div></div>
            <div class="kpi-card"><h3>总分良好率 (%)</h3><div class="value">${totalStats.goodRate || 0}</div></div>
            <div class="kpi-card"><h3>总分及格率 (%)</h3><div class="value">${totalStats.passRate || 0}</div></div>
            <div class="kpi-card"><h3>总分不及格率 (%)</h3><div class="value">${totalStats.failRate || 0}</div></div>
            <div class="kpi-card"><h3>总分标准差</h3><div class="value">${totalStats.stdDev || 0}</div></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px; border-left: 5px solid #20c997;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">
                <h3 style="margin:0; color:#333;">📈 成绩分段人数分布 (曲线图)</h3>
                <div class="controls-bar" style="background:transparent; box-shadow:none; padding:0; margin:0; align-items:center;">
                    <label>科目:</label>
                    <select id="curve-subject-select" class="sidebar-select" style="width:auto; min-width:100px;">
                        <option value="totalScore">总分</option>
                        <option value="ALL_SUBJECTS" style="color:#6f42c1; font-weight:bold;">📌 全科对比 (All)</option>
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    
                    <div style="display:flex; align-items:center; margin-left:15px;">
                        <input type="checkbox" id="curve-compare-class" style="margin-right:5px; cursor:pointer;">
                        <label for="curve-compare-class" style="cursor:pointer; user-select:none; font-weight:bold; color:#007bff;">对比各班</label>
                    </div>

                    <label style="margin-left:15px;">分段间隔:</label>
                    <input type="number" id="curve-bin-size" value="50" style="width:60px; text-align:center;" class="sidebar-select">
                    <button id="btn-update-curve" class="sidebar-button" style="margin-left:10px; padding:5px 15px; background-color:#20c997;">确定</button>
                </div>
            </div>
            <div class="chart-container" id="score-distribution-curve" style="height: 400px;"></div>
            <div id="curve-analysis-text" style="background:#f8f9fa; padding:15px; border-radius:6px; margin-top:10px; color:#555; font-size:0.95em; line-height:1.6;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h3>全科统计表</h3>
            <div class="table-container" style="max-height: 400px;">
                <table>
                    <thead>
                        <tr>
                            <th>科目</th><th>考试人数</th><th>平均分</th><th>最高分</th><th>中位数</th><th>优秀率 (%)</th><th>良好率 (%)</th><th>及格率 (%)</th><th>标准差</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-score-row">
                            <td><strong>${stats.totalScore.name}</strong></td>
                            <td>${stats.totalScore.count}</td><td>${stats.totalScore.average}</td><td>${stats.totalScore.max}</td><td>${stats.totalScore.median}</td>
                            <td>${stats.totalScore.excellentRate}</td><td>${stats.totalScore.goodRate || 0}</td><td>${stats.totalScore.passRate}</td><td>${stats.totalScore.stdDev || 0}</td>
                        </tr>
                        ${G_DynamicSubjectList.map(subject => stats[subject]).filter(s => s).map(s => `
                            <tr>
                                <td><strong>${s.name}</strong></td>
                                <td>${s.count}</td><td>${s.average}</td><td>${s.max}</td><td>${s.median}</td>
                                <td>${s.excellentRate}</td><td>${s.goodRate || 0}</td><td>${s.passRate}</td><td>${s.stdDev || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="dashboard-chart-grid-2x2">
            <div class="main-card-wrapper"><div class="controls-bar chart-controls"><h4 style="margin:0;">全科分数分布箱形图</h4></div><div class="chart-container" id="subject-boxplot-chart" style="height: 350px;"></div></div>
            <div class="main-card-wrapper"><div class="controls-bar chart-controls"><label>科目:</label><select id="class-compare-subject" class="sidebar-select" style="min-width: 100px;"><option value="totalScore">总分</option>${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}</select><label>指标:</label><select id="class-compare-metric" class="sidebar-select" style="min-width: 120px;"><option value="average">平均分</option><option value="passRate">及格率 (%)</option><option value="stdDev">标准差</option><option value="max">最高分</option><option value="median">中位数</option></select></div><div class="chart-container" id="class-compare-chart" style="height: 350px;"></div></div>
            <div class="main-card-wrapper"><div class="chart-container" id="radar-chart" style="height: 400px;"></div></div>
            
            <div class="main-card-wrapper"><div class="controls-bar chart-controls"><label>分段:</label><input type="number" id="histogram-bin-size" value="30" style="width: 60px;"><button id="histogram-redraw-btn" class="sidebar-button" style="width: auto;">重绘</button></div><div class="chart-container" id="histogram-chart" style="height: 350px;"></div></div>
            
            <div class="main-card-wrapper"><div class="controls-bar chart-controls"><label>X轴:</label><select id="scatter-x-subject" class="sidebar-select">${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}</select><label>Y轴:</label><select id="scatter-y-subject" class="sidebar-select">${G_DynamicSubjectList.map((s, i) => `<option value="${s}" ${i === 1 ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div class="chart-container" id="correlation-scatter-chart" style="height: 350px;"></div></div>
            <div class="main-card-wrapper"><div class="controls-bar chart-controls"><h4 style="margin:0;">各科 A/B/C/D 构成</h4></div><div class="chart-container" id="stacked-bar-chart" style="height: 350px;"></div></div>
            <div class="main-card-wrapper" style="grid-column: span 2;"><div class="controls-bar chart-controls"><h4 style="margin:0;">贡献度分析</h4></div><div class="chart-container" id="contribution-chart" style="height: 400px;"></div></div>
        </div>

        <div class="main-card-wrapper" style="margin-top: 20px; min-height: 500px;">
            <style>
                #dashboard-full-table th:nth-child(1), #dashboard-full-table td:nth-child(1) { position: sticky; left: 0; z-index: 2; background-color: #fff; width: 90px; }
                #dashboard-full-table th:nth-child(2), #dashboard-full-table td:nth-child(2) { position: sticky; left: 90px; z-index: 2; background-color: #fff; width: 90px; }
                #dashboard-full-table th:nth-child(3), #dashboard-full-table td:nth-child(3) { position: sticky; left: 180px; z-index: 2; background-color: #fff; width: 110px; border-right: 2px solid #dcdfe6 !important; box-shadow: 2px 0 5px -2px rgba(0,0,0,0.1); }
                #dashboard-full-table thead th:nth-child(1), #dashboard-full-table thead th:nth-child(2), #dashboard-full-table thead th:nth-child(3) { z-index: 5; background-color: #f8f9fa; }
                .subject-dropdown-content { display: none; position: absolute; background-color: #fff; min-width: 200px; box-shadow: 0 8px 16px rgba(0,0,0,0.2); z-index: 10; padding: 10px; border-radius: 4px; border: 1px solid #eee; top: 100%; left: 0; }
                .subject-dropdown-content.show { display: block; }
                .subject-checkbox-item { display: block; margin: 5px 0; cursor: pointer; }
            </style>

            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 15px; margin-bottom:15px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
                <div style="display:flex; flex-direction:column;">
                    <h3 style="margin:0; white-space: nowrap;">📋 动态成绩明细表</h3>
                    <span style="font-size:0.8em; color:#e6a23c; margin-top:4px;">⚡️ 勾选科目后，总分与排名将实时重算</span>
                </div>
                
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="position: relative;">
                        <button id="btn-toggle-subjects" class="sidebar-button" style="background-color:#6f42c1; padding: 6px 15px; font-size: 0.9em;">📚 选择科目 ▼</button>
                        <div id="subject-dropdown" class="subject-dropdown-content">
                            <div style="border-bottom:1px solid #eee; padding-bottom:5px; margin-bottom:5px; display:flex; justify-content:space-between;">
                                <span style="font-weight:bold; font-size:0.9em;">参与计算的科目:</span>
                                <a href="#" id="btn-all-subjects" style="font-size:0.8em; color:#007bff;">全选</a>
                            </div>
                            <div id="subject-checkbox-list" style="max-height:200px; overflow-y:auto;"></div>
                        </div>
                    </div>
                    <button id="btn-print-dynamic-table" class="sidebar-button" style="background-color:#17a2b8; padding: 6px 15px; font-size: 0.9em;">🖨️ 打印清单</button>
                    <div style="display:flex; align-items:center; gap:10px; background-color: #f8f9fa; padding: 6px 15px; border-radius: 20px; border: 1px solid #e9ecef;">
                        <span style="font-size:1.1em;">🔍</span>
                        <select id="dashboard-table-filter" class="sidebar-select" style="width:auto; min-width:130px; padding: 4px 8px; height: 34px; margin:0;">
                            <option value="ALL">-- 全部班级 --</option>
                        </select>
                        <input type="text" id="dashboard-table-search" placeholder="输入姓名或考号..." class="sidebar-select" style="width: 160px; padding: 4px 8px; height: 34px; margin:0;">
                    </div>
                </div>
            </div>
            
            <div class="table-container" style="max-height: 600px; overflow-y: auto; border: 1px solid #eee;">
                <table id="dashboard-full-table" style="border-collapse: separate; border-spacing: 0;">
                    <thead id="dashboard-table-head"></thead>
                    <tbody id="dashboard-full-tbody"></tbody>
                </table>
            </div>
            <div style="margin-top:8px; font-size:0.85em; color:#999; text-align:right;">
                * 向右滑动表格可固定身份列。显示格式：<b>分数 (年排)</b>。<span style="color:#dc3545;">红色</span>代表不及格。
            </div>
        </div>
    `;

    // ============================================
    // 3. 定义绘图辅助函数 (关键修复：先定义，再绑定)
    // ============================================

    // (1) 直方图函数
    const drawHistogram = () => {
        if (totalStats.scores && totalStats.scores.length > 0) {
            const fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
            const binSize = parseInt(document.getElementById('histogram-bin-size').value) || 30;
            if (typeof renderHistogram === 'function') {
                renderHistogram('histogram-chart', activeData, 'totalScore', fullScore, `总分分数段直方图 (分段=${binSize})`, binSize);
            }
        }
    };

    // (2) 曲线图函数
// (2) 曲线图函数 (更新版)
    const updateCurveChart = () => {
        const subject = document.getElementById('curve-subject-select').value;
        const binSize = parseInt(document.getElementById('curve-bin-size').value) || 50;
        const isClassCompare = document.getElementById('curve-compare-class').checked; // 获取勾选状态

        // 注意：如果是“对比各班”模式，我们需要强制传入所有学生数据(G_StudentsData)，而不是筛选后的(activeData)
        const sourceData = isClassCompare ? G_StudentsData : activeData;

        if (typeof renderScoreCurve === 'function') {
            renderScoreCurve('score-distribution-curve', sourceData, subject, binSize, isClassCompare);
        }
    };
    
    // 新增：绑定 checkbox 的 change 事件，一点就刷新
    const compareCb = document.getElementById('curve-compare-class');
    if(compareCb) {
        compareCb.addEventListener('change', updateCurveChart);
    }

    // (3) 班级对比图函数
    const updateClassChart = () => {
        const classCompareSel = document.getElementById('class-compare-subject');
        const classMetricSel = document.getElementById('class-compare-metric');
        if (!classCompareSel || G_CurrentClassFilter !== 'ALL') return;
        
        const d = calculateClassComparison(classMetricSel.value, classCompareSel.value);
        let subName = classCompareSel.value === 'totalScore' ? '总分' : classCompareSel.value;
        let metName = classMetricSel.options[classMetricSel.selectedIndex].text;
        renderClassComparisonChart('class-compare-chart', d, `各班级 - ${subName} ${metName} 对比`);
    };

    // (4) 散点图函数
    const updateScat = () => {
        const scatX = document.getElementById('scatter-x-subject');
        const scatY = document.getElementById('scatter-y-subject');
        if (scatX && scatY) {
            renderCorrelationScatterPlot('correlation-scatter-chart', activeData, scatX.value, scatY.value);
        }
    };

    // (5) 贡献度图函数
    const drawContribution = () => {
        if (G_CurrentClassFilter === 'ALL') {
            document.getElementById('contribution-chart').innerHTML = `<p style="text-align:center; padding-top:50px; color:#999;">请选择具体班级以查看贡献度分析。</p>`;
            return;
        }
        const globalStats = calculateAllStatistics(G_StudentsData); 
        const subjects = G_DynamicSubjectList;
        const contributionData = subjects.map(sub => {
            const classAvg = stats[sub] ? stats[sub].average : 0;
            const gradeAvg = globalStats[sub] ? globalStats[sub].average : 0;
            return parseFloat((classAvg - gradeAvg).toFixed(2));
        });
        const totalDiff = contributionData.reduce((a, b) => a + b, 0).toFixed(2);
        renderContributionChart('contribution-chart', subjects, contributionData, totalDiff);
    };

    // ============================================
    // 4. 绑定事件
    // ============================================
    
    // 曲线图
    const curveBinInput = document.getElementById('curve-bin-size');
    const curveSubjectSelect = document.getElementById('curve-subject-select');
    document.getElementById('btn-update-curve').addEventListener('click', updateCurveChart);
    curveSubjectSelect.addEventListener('change', () => {
        if (curveSubjectSelect.value === 'totalScore') curveBinInput.value = 50;
        else curveBinInput.value = 10;
        updateCurveChart();
    });

    // 直方图
    document.getElementById('histogram-redraw-btn').addEventListener('click', drawHistogram);

    // 班级对比
    const classCompareSel = document.getElementById('class-compare-subject');
    const classMetricSel = document.getElementById('class-compare-metric');
    if(classCompareSel) {
        classCompareSel.addEventListener('change', updateClassChart);
        classMetricSel.addEventListener('change', updateClassChart);
    }

    // 散点图
    const scatX = document.getElementById('scatter-x-subject');
    const scatY = document.getElementById('scatter-y-subject');
    if(scatX) {
        scatX.addEventListener('change', updateScat);
        scatY.addEventListener('change', updateScat);
    }

    // ============================================
    // 5. [核心] 动态表格逻辑实现
    // ============================================
    const initDynamicTable = () => {
        const dropdownBtn = document.getElementById('btn-toggle-subjects');
        const dropdownContent = document.getElementById('subject-dropdown');
        const checkboxList = document.getElementById('subject-checkbox-list');
        const btnAll = document.getElementById('btn-all-subjects');
        const filterSelect = document.getElementById('dashboard-table-filter');
        const searchInput = document.getElementById('dashboard-table-search');
        const tableHead = document.getElementById('dashboard-table-head');
        const tableBody = document.getElementById('dashboard-full-tbody');

        // A. 填充 Checkbox
        checkboxList.innerHTML = G_DynamicSubjectList.map(sub => `
            <label class="subject-checkbox-item">
                <input type="checkbox" value="${sub}" checked> ${sub}
            </label>
        `).join('');

        // B. 填充班级筛选
        const allClassSet = new Set(G_StudentsData.map(s => s.class));
        const allClasses = Array.from(allClassSet).sort();
        filterSelect.innerHTML = `<option value="ALL">-- 全部班级 --</option>` + allClasses.map(c => `<option value="${c}">${c}</option>`).join('');
        if (G_CurrentClassFilter !== 'ALL') filterSelect.value = G_CurrentClassFilter;

        // --- 核心渲染函数 ---
        const renderDynamicData = () => {
            const dynamicData = G_StudentsData.map(s => {
                let dynamicTotal = 0;
                let hasScore = false;
                currentSelectedSubjects.forEach(sub => {
                    const score = s.scores[sub];
                    if (typeof score === 'number') { dynamicTotal += score; hasScore = true; }
                });
                if (!hasScore) dynamicTotal = -1;
                return { raw: s, id: s.id, name: s.name, class: s.class, dynamicTotal: parseFloat(dynamicTotal.toFixed(2)), dynamicRank: 0 };
            });

            dynamicData.sort((a, b) => b.dynamicTotal - a.dynamicTotal);
            dynamicData.forEach((item, index) => {
                item.dynamicRank = (item.dynamicTotal >= 0) ? (index + 1) : '-';
                if (item.dynamicTotal < 0) item.dynamicTotal = 0;
            });

            const filterClass = filterSelect.value;
            const searchText = searchInput.value.toLowerCase().trim();
            let displayList = dynamicData.filter(item => {
                if (filterClass !== 'ALL' && item.class !== filterClass) return false;
                if (searchText && !item.name.includes(searchText) && !String(item.id).includes(searchText)) return false;
                return true;
            });

            const { key, direction } = G_DashboardTableSort;
            displayList.sort((a, b) => {
                let valA, valB;
                if (key === 'dynamicTotal' || key === 'dynamicRank') {
                    valA = a[key]; valB = b[key];
                    if (valA === '-') valA = -9999; if (valB === '-') valB = -9999;
                } else if (key.startsWith('scores.')) {
                    const sub = key.split('.')[1];
                    valA = a.raw.scores[sub] ?? -Infinity;
                    valB = b.raw.scores[sub] ?? -Infinity;
                } else { valA = a[key]; valB = b[key]; }
                if (typeof valA === 'string') return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                return direction === 'asc' ? valA - valB : valB - valA;
            });

            let theadHtml = `<tr><th data-sort="id" style="cursor:pointer;">学号 ⇅</th><th data-sort="name" style="cursor:pointer;">姓名 ⇅</th><th data-sort="class" style="cursor:pointer;">班级 ⇅</th>`;
            currentSelectedSubjects.forEach(sub => { theadHtml += `<th data-sort="scores.${sub}" style="cursor:pointer; min-width:80px;">${sub} ⇅</th>`; });
            theadHtml += `<th data-sort="dynamicTotal" style="cursor:pointer; background-color:#e8f0fe; min-width:90px; border-left:2px solid #eee;">自定义总分 ⇅</th><th data-sort="dynamicRank" style="cursor:pointer; background-color:#e8f0fe; min-width:80px;">  排名 ⇅</th></tr>`;
            tableHead.innerHTML = theadHtml;

            const limit = 500;
            const renderList = displayList.slice(0, limit);

            if (renderList.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${5 + currentSelectedSubjects.length}" style="text-align:center; padding:20px; color:#999;">无数据</td></tr>`;
                return;
            }

            tableBody.innerHTML = renderList.map(item => {
                let row = `<tr><td>${item.id}</td><td style="font-weight:bold;">${item.name}</td><td>${item.class}</td>`;
                currentSelectedSubjects.forEach(sub => {
                    const score = item.raw.scores[sub];
                    const val = score !== undefined ? score : '-';
                    const rank = (item.raw.gradeRanks && item.raw.gradeRanks[sub]) ? item.raw.gradeRanks[sub] : '-';
                    const passLine = (G_SubjectConfigs[sub] && G_SubjectConfigs[sub].pass) ? G_SubjectConfigs[sub].pass : 60;
                    const style = (typeof score === 'number' && score < passLine) ? 'color:#dc3545; font-weight:bold;' : '';
                    row += `<td style="${style}">${val} <span style="font-size:0.8em; color:#999; font-weight:normal;">(${rank})</span></td>`;
                });
                row += `<td style="font-weight:bold; color:#6f42c1; background-color:#f8faff; border-left:2px solid #eee;">${item.dynamicTotal}</td><td style="font-weight:bold; color:#6f42c1; background-color:#f8faff;">${item.dynamicRank}</td></tr>`;
                return row;
            }).join('');

            if (displayList.length > limit) tableBody.innerHTML += `<tr><td colspan="100" style="text-align:center; color:#999;">(仅显示前 ${limit} 条，请使用筛选缩小范围)</td></tr>`;
        };

        // 打印功能 (修复版：    动态班级排名 + 调整宽度)
        document.getElementById('btn-print-dynamic-table').addEventListener('click', () => {
            // 1. [第一步] 基础计算：算总分、算年排
            const dynamicData = G_StudentsData.map(s => {
                let dynamicTotal = 0;
                let hasScore = false;
                currentSelectedSubjects.forEach(sub => {
                    const score = s.scores[sub];
                    if (typeof score === 'number') { dynamicTotal += score; hasScore = true; }
                });
                if (!hasScore) dynamicTotal = -1;
                return { raw: s, dynamicTotal: parseFloat(dynamicTotal.toFixed(2)) };
            });
            
            // 全校排序 -> 得到年级排名
            dynamicData.sort((a, b) => b.dynamicTotal - a.dynamicTotal);
            dynamicData.forEach((item, index) => { 
                item.dynamicRank = (item.dynamicTotal >= 0) ? (index + 1) : '-'; 
            });

            // 2. [    第二步] 进阶计算：算班级排名
            // 先按班级分组
            const classGroups = {};
            dynamicData.forEach(item => {
                const cls = item.raw.class;
                if (!classGroups[cls]) classGroups[cls] = [];
                classGroups[cls].push(item);
            });
            // 组内排序并标记班排
            Object.values(classGroups).forEach(group => {
                group.sort((a, b) => b.dynamicTotal - a.dynamicTotal);
                group.forEach((item, idx) => {
                    item.dynamicClassRank = (item.dynamicTotal >= 0) ? (idx + 1) : '-';
                });
            });

            // 3. [第三步] 筛选 (应用当前的搜索/筛选条件)
            const filterClass = filterSelect.value;
            const searchText = searchInput.value.toLowerCase().trim();
            const printList = dynamicData.filter(item => {
                if (filterClass !== 'ALL' && item.raw.class !== filterClass) return false;
                if (searchText && !item.raw.name.includes(searchText) && !String(item.raw.id).includes(searchText)) return false;
                return true;
            });

            if (printList.length === 0) { alert("当前列表为空"); return; }
            if (printList.length > 300 && !confirm(`即将打印 ${printList.length} 条数据，确认？`)) return;

            // 4. [第四步] 生成 HTML
            let rowsHtml = '';
            printList.forEach((item, index) => {
                const s = item.raw;
                let scoresHtml = '';
                
                currentSelectedSubjects.forEach(sub => {
                    const score = s.scores[sub] !== undefined ? s.scores[sub] : '-';
                    const rank = (s.gradeRanks && s.gradeRanks[sub]) ? s.gradeRanks[sub] : '-';
                    const passLine = (G_SubjectConfigs[sub] && G_SubjectConfigs[sub].pass) ? G_SubjectConfigs[sub].pass : 60;
                    const colorStyle = (typeof s.scores[sub] === 'number' && s.scores[sub] < passLine) ? 'color:#dc3545;' : '';

                    scoresHtml += `
                        <div class="score-item">
                            <span class="subject-name">${sub}</span>
                            <span class="score-val" style="${colorStyle}">
                                ${score} <span style="font-size:0.8em; color:#999; font-weight:normal;">(${rank})</span>
                            </span>
                        </div>`;
                });

                // [修改] 左侧  加了班排徽章
                rowsHtml += `
                    <div class="student-row">
                        <div class="student-info">
                            <div style="display:flex; flex-direction:column; gap:2px; margin-right:5px;">
                                <span class="rank-badge" style="background:#555;" title="年级排名">年${item.dynamicRank}</span>
                                <span class="rank-badge" style="background:#17a2b8;" title="班级排名">班${item.dynamicClassRank}</span>
                            </div>
                            <div style="display:flex; flex-direction:column;">
                                <span class="name">${s.name}</span>
                                <span class="class">${s.class}</span>
                            </div>
                        </div>
                        <div class="scores-grid">${scoresHtml}</div>
                        <div class="total-info">
                            <span>总分: <strong>${item.dynamicTotal >= 0 ? item.dynamicTotal : '-'}</strong></span>
                        </div>
                    </div>
                `;
                
                if (index < printList.length - 1) {
                    rowsHtml += `<div class="spacer"></div><div class="dashed-line"></div><div class="spacer"></div>`;
                }
            });

            const printHtml = `
                <html>
                <head>
                    <title>成绩清单</title>
                    <style>
                        body { font-family: sans-serif; padding: 20px; color: #333; }
                        h2 { text-align: center; margin-bottom: 10px; }
                        
                        .student-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
                        
                        /* [修改] 宽度加宽到 280px，容纳双排名 */
                        .student-info { width: 180px; display: flex; align-items: center; gap: 8px; border-right: 1px solid #eee; padding-right: 10px; }
                        
                        .rank-badge { 
                            color: white; padding: 1px 4px; border-radius: 3px; 
                            min-width: 35px; text-align: center; font-size: 0.8em; font-weight: bold; 
                        }
                        .name { font-weight: bold; font-size: 1.1em; } 
                        .class { color: #666; font-size: 0.85em; }
                        
                        .scores-grid { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; padding: 0 15px; }
                        .score-item { border: 1px solid #eee; padding: 2px 6px; font-size: 0.9em; background: #f9f9f9; border-radius: 3px; }
                        .subject-name { color: #888; margin-right: 3px; }
                        .score-val { font-weight: bold; }
                        
                        .total-info { width: 120px; text-align: right; color: #6f42c1; font-size: 1.1em; }
                        
                        .dashed-line { border-bottom: 1px dashed #ccc; width: 100%; }
                        .spacer { height: 8px; }
                        
                        @media print { 
                            .rank-badge { -webkit-print-color-adjust: exact; } 
                            .score-item { -webkit-print-color-adjust: exact; }
                        }
                    </style>
                </head>
                <body>
                    <h2>📄 动态成绩清单</h2>
                    <p style="text-align:center;color:#666;font-size:0.9em; margin-bottom:20px;">
                        包含科目：${currentSelectedSubjects.join('、')}
                    </p>
                    ${rowsHtml}
                </body>
                </html>
            `;
            
            const win = window.open('', '_blank');
            win.document.write(printHtml);
            win.document.close();
            setTimeout(() => { win.focus(); win.print(); }, 500);
        });

        // --- 事件绑定 ---
        const triggerUpdate = () => {
            const cbs = checkboxList.querySelectorAll('input:checked');
            currentSelectedSubjects = Array.from(cbs).map(cb => cb.value);
            dropdownBtn.innerText = `📚 选择科目 (${currentSelectedSubjects.length}) ▼`;
            renderDynamicData();
        };
        checkboxList.addEventListener('change', triggerUpdate);
        btnAll.addEventListener('click', (e) => {
            e.preventDefault();
            const cbs = checkboxList.querySelectorAll('input');
            const allChecked = Array.from(cbs).every(cb => cb.checked);
            cbs.forEach(cb => cb.checked = !allChecked);
            triggerUpdate();
        });
        dropdownBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdownContent.classList.toggle('show'); });
        document.addEventListener('click', (e) => { if (!dropdownBtn.contains(e.target) && !dropdownContent.contains(e.target)) dropdownContent.classList.remove('show'); });
        filterSelect.addEventListener('change', renderDynamicData);
        searchInput.addEventListener('input', renderDynamicData);
        tableHead.addEventListener('click', (e) => {
            const th = e.target.closest('th'); if (!th) return;
            const sortKey = th.dataset.sort;
            if (sortKey) {
                if (G_DashboardTableSort.key === sortKey) G_DashboardTableSort.direction = G_DashboardTableSort.direction === 'asc' ? 'desc' : 'asc';
                else { G_DashboardTableSort.key = sortKey; G_DashboardTableSort.direction = 'desc'; }
                renderDynamicData();
            }
        });

        renderDynamicData();
    };

    // 6. 初始执行
    updateCurveChart();
    drawHistogram();
    updateClassChart();
    updateScat();
    drawContribution();
    if(typeof renderAverageRadar === 'function') renderAverageRadar('radar-chart', stats);
    if(typeof renderSubjectBoxPlot === 'function') renderSubjectBoxPlot('subject-boxplot-chart', G_Statistics, activeData);
    if(typeof renderStackedBar === 'function') renderStackedBar('stacked-bar-chart', G_Statistics, G_SubjectConfigs);
    
    initDynamicTable();
}
/**
 * (修改后) 9.2. 模块二：学生个体报告 (    ：隐藏排名按钮)
 */
function renderStudent(container, students, stats) {
    // 初始化隐藏状态 (如果没有定义过)
    if (typeof window.G_HideRank === 'undefined') window.G_HideRank = false;
    // --- [    ] 防御性检查：如果发现排名缺失，尝试现场补算 ---
    if (students.length > 0 && (!students[0].classRanks || !students[0].gradeRanks)) {
        console.log("检测到排名数据缺失，正在自动补全...");
        // 重  计算排名
        const recalculated = addSubjectRanksToData(students);
        // 更  引用 (注意：这不会更   IndexedDB，只更  当前视图)
        students = recalculated; 
    }

    // 1. 渲染搜索框、操作按钮 和 结果容器
    container.innerHTML = `
        <h2>模块二：学生个体报告 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="controls-bar">
            <label for="student-search">搜索学生 (姓名/考号):</label>
            <div class="search-combobox">
                <input type="text" id="student-search" placeholder="输入姓名或考号..." autocomplete="off">
                <div class="search-results" id="student-search-results"></div>
            </div>
            
            <button id="toggle-rank-btn" class="sidebar-button" style="margin-left: auto; background-color: ${window.G_HideRank ? '#6c757d' : '#fd7e14'};">
                ${window.G_HideRank ? '👁️ 显示排名' : '🚫 隐藏排名'}
            </button>

            <button id="open-print-modal-btn" class="sidebar-button" style="margin-left: 10px; background-color: var(--color-blue);">
                🖨️ 打印报告
            </button>
        </div>
        <div id="student-report-content">
            <p>请输入关键词以搜索学生。</p>
        </div>
    `;

    const searchInput = document.getElementById('student-search');
    const resultsContainer = document.getElementById('student-search-results');
    const contentEl = document.getElementById('student-report-content');
    const openPrintModalBtn = document.getElementById('open-print-modal-btn');
    const toggleRankBtn = document.getElementById('toggle-rank-btn'); // [    ]

    // [    ] 绑定隐藏排名按钮事件
    toggleRankBtn.addEventListener('click', () => {
        window.G_HideRank = !window.G_HideRank; // 切换状态

        // 更  按钮样式
        toggleRankBtn.innerHTML = window.G_HideRank ? '👁️ 显示排名' : '🚫 隐藏排名';
        toggleRankBtn.style.backgroundColor = window.G_HideRank ? '#6c757d' : '#fd7e14';

        // 如果当前有选中的学生，立即刷  显示
        const currentStudentId = contentEl.dataset.currentStudentId;
        if (currentStudentId) {
            showReport(currentStudentId);
        }
    });

    // [打印功能] (保持不变)
    const printBtnCurrent = document.getElementById('print-btn-current');
    const printBtnFilter = document.getElementById('print-btn-filter');
    const printModal = document.getElementById('print-modal');

    openPrintModalBtn.addEventListener('click', () => {
        const currentStudentId = contentEl.dataset.currentStudentId;
        if (currentStudentId) {
            const currentStudentName = contentEl.dataset.currentStudentName;
            printBtnCurrent.innerHTML = `🖨️ 打印当前学生 (${currentStudentName})`;
            printBtnCurrent.dataset.studentId = currentStudentId;
            printBtnCurrent.disabled = false;
        } else {
            printBtnCurrent.innerHTML = `🖨️ 打印当前学生 (未选择)`;
            printBtnCurrent.dataset.studentId = '';
            printBtnCurrent.disabled = true;
        }
        const filterText = (G_CurrentClassFilter === 'ALL') ? '全体年段' : G_CurrentClassFilter;
        printBtnFilter.innerHTML = `🖨️ 打印当前筛选 (${filterText})`;
        printModal.style.display = 'flex';
    });

    // 内部函数：显示报告
    const showReport = (studentId) => {
        const student = students.find(s => String(s.id) === String(studentId));
        if (!student) {
            contentEl.innerHTML = `<p>未找到学生。</p>`;
            return;
        }

        contentEl.dataset.currentStudentId = student.id;
        contentEl.dataset.currentStudentName = student.name;

        let oldStudent = null;
        let scoreDiff = 'N/A', rankDiff = 'N/A', gradeRankDiff = 'N/A';

        if (G_CompareData && G_CompareData.length > 0) {
            oldStudent = G_CompareData.find(s => String(s.id) === String(student.id));
        }

        if (oldStudent) {
            scoreDiff = (student.totalScore - oldStudent.totalScore).toFixed(2);
            rankDiff = oldStudent.rank - student.rank;
            gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 'N/A';
        }

        // [    ] 掩码辅助函数
        const maskRank = (val) => window.G_HideRank ? '***' : val;
        // 如果隐藏排名，也不显示排名的变化（进退步）
        const maskDiff = (diffVal, diffText) => window.G_HideRank ? '' : (diffVal !== 'N/A' && oldStudent ? diffText : '');

        contentEl.innerHTML = `
            <div class="student-card">
                <div class="sc-name"><span>姓名</span><strong>${student.name}</strong></div>
                <div class="sc-id"><span>考号</span><strong>${student.id}</strong></div>
                
                <div class="sc-total">
                    <span>总分 (上次: ${oldStudent ? oldStudent.totalScore : 'N/A'})</span>
                    <strong class="${scoreDiff > 0 ? 'progress' : scoreDiff < 0 ? 'regress' : ''}">
                        ${student.totalScore}
                        ${(scoreDiff !== 'N/A' && oldStudent) ? `(${scoreDiff > 0 ? '▲' : '▼'} ${Math.abs(scoreDiff)})` : ''}
                    </strong>
                </div>

                <div class="sc-rank">
                    <span>班级排名 (上次: ${maskRank(oldStudent ? oldStudent.rank : 'N/A')})</span>
                    <strong class="${rankDiff > 0 ? 'progress' : rankDiff < 0 ? 'regress' : ''}">
                        ${maskRank(student.rank)}
                        ${maskDiff(rankDiff, `(${rankDiff > 0 ? '▲' : '▼'} ${Math.abs(rankDiff)})`)}
                    </strong>
                </div>

                <div class="sc-grade-rank">
                    <span>年级排名 (上次: ${maskRank(oldStudent ? (oldStudent.gradeRank || 'N/A') : 'N/A')})</span>
                    <strong class="${gradeRankDiff > 0 ? 'progress' : gradeRankDiff < 0 ? 'regress' : ''}">
                        ${maskRank(student.gradeRank || 'N/A')}
                        ${maskDiff(gradeRankDiff, `(${gradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(gradeRankDiff)})`)}
                    </strong>
                </div>
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>科目</th>
                            <th>得分 (变化)</th>
                            <th>班级科目排名 (变化)</th>
                            <th>年级科目排名 (变化)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${G_DynamicSubjectList.map(subject => {
            let subjectScoreDiff = 'N/A';
            let subjectClassRankDiff = 'N/A';
            let subjectGradeRankDiff = 'N/A';

            if (oldStudent && oldStudent.scores) {
                const oldScore = oldStudent.scores[subject] || 0;
                const newScore = student.scores[subject] || 0;
                if (oldScore !== 0 || newScore !== 0) {
                    subjectScoreDiff = (newScore - oldScore).toFixed(2);
                }
                if (oldStudent.classRanks && student.classRanks) {
                    const oldClassRank = oldStudent.classRanks[subject] || 0;
                    const newClassRank = student.classRanks[subject] || 0;
                    if (oldClassRank > 0 && newClassRank > 0) {
                        subjectClassRankDiff = oldClassRank - newClassRank;
                    }
                }
                if (oldStudent.gradeRanks && student.gradeRanks) {
                    const oldGradeRank = oldStudent.gradeRanks[subject] || 0;
                    const newGradeRank = student.gradeRanks[subject] || 0;
                    if (oldGradeRank > 0 && newGradeRank > 0) {
                        subjectGradeRankDiff = oldGradeRank - newGradeRank;
                    }
                }
            }

            const config = G_SubjectConfigs[subject] || {};
            const isAssignedSubject = config.isAssigned === true;
            let rankBasedScoreDisplay = '';
            if (isAssignedSubject) {
                const allScoresForSubject = G_StudentsData.map(s => s.scores[subject]);
                const fujianScore = calculateFujianAssignedScore(student.scores[subject], allScoresForSubject);
                rankBasedScoreDisplay = `<div style="font-size:0.85em; color:#6f42c1; margin-top:4px; font-weight:bold;">赋分: ${fujianScore}</div>`;
            } else {
                rankBasedScoreDisplay = `<div style="font-size:0.8em; color:#aaa; margin-top:4px;">(原始分)</div>`;
            }

            const tScore = (student.tScores && student.tScores[subject]) ? student.tScores[subject] : 'N/A';
            let tScoreDiffHtml = '';
            if (oldStudent && oldStudent.tScores && oldStudent.tScores[subject]) {
                const oldTScore = oldStudent.tScores[subject];
                if (tScore !== 'N/A') {
                    const diff = tScore - oldTScore;
                    const diffAbs = Math.abs(diff).toFixed(1);
                    if (diff > 0) tScoreDiffHtml = `<span class="progress" style="font-size:0.9em; margin-left:4px;">(▲${diffAbs})</span>`;
                    else if (diff < 0) tScoreDiffHtml = `<span class="regress" style="font-size:0.9em; margin-left:4px;">(▼${diffAbs})</span>`;
                }
            }

            return `
                                <tr>
                                    <td>${subject}</td>
                                    <td>
                                        <div>
                                            ${student.scores[subject] || 0}
                                            ${(oldStudent && subjectScoreDiff !== 'N/A') ? `<span class="${subjectScoreDiff > 0 ? 'progress' : subjectScoreDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectScoreDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectScoreDiff)})</span>` : ''}
                                        </div>
                                        <div style="font-size:0.8em; color:#666; margin-top:4px;">
                                            T分: <strong>${tScore}</strong> ${tScoreDiffHtml}
                                        </div>
                                    </td>
                                    <td>
                                        ${maskRank(student.classRanks ? (student.classRanks[subject] || 'N/A') : 'N/A')}
                                        ${maskDiff(subjectClassRankDiff, `<span class="${subjectClassRankDiff > 0 ? 'progress' : subjectClassRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectClassRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectClassRankDiff)})</span>`)}
                                    </td>
                                    <td>
                                        <div>
                                            ${maskRank(student.gradeRanks ? (student.gradeRanks[subject] || 'N/A') : 'N/A')}
                                            ${maskDiff(subjectGradeRankDiff, `<span class="${subjectGradeRankDiff > 0 ? 'progress' : subjectGradeRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectGradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectGradeRankDiff)})</span>`)}
                                        </div>
                                        ${rankBasedScoreDisplay}
                                    </td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="main-card-wrapper" style="margin-top: 20px;">
                <div class="chart-container" id="student-radar-chart" style="height: 400px;"></div>
            </div>
        `;

        renderStudentRadar('student-radar-chart', student, stats);
    };

    // 监听搜索输入 (保持不变)
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length < 1) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }
        const filteredStudents = students.filter(s => {
            return String(s.name).toLowerCase().includes(searchTerm) ||
                String(s.id).toLowerCase().includes(searchTerm);
        }).slice(0, 50);

        if (filteredStudents.length === 0) {
            resultsContainer.innerHTML = '<div class="result-item">-- 未找到 --</div>';
        } else {
            resultsContainer.innerHTML = filteredStudents.map(s => {
                return `<div class="result-item" data-id="${s.id}">
                    <strong>${s.name}</strong> (${s.id}) - 班排: ${window.G_HideRank ? '***' : s.rank}
                </div>`;
            }).join('');
        }
        resultsContainer.style.display = 'block';
    });

    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item && item.dataset.id) {
            const studentId = item.dataset.id;
            searchInput.value = `${item.querySelector('strong').innerText} (${studentId})`;
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            showReport(studentId);
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    searchInput.addEventListener('focus', () => {
        if (resultsContainer.innerHTML !== '') {
            resultsContainer.style.display = 'block';
        }
    });
}

/**
 * 9.3. 模块三：试卷科目分析
 *    已修改：签名  加 activeData, drawChart 传递 activeData
 */
function renderPaper(container, stats, activeData) {
    // 1.   渲染 1x4 垂直布局
    container.innerHTML = `
        <h2>模块三：试卷科目分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div class="controls-bar chart-controls" style="align-items:center; flex-wrap:wrap;">
                    <label for="subject-select">选择科目:</label>
                    <select id="subject-select" class="sidebar-select" style="margin-right:15px;">
                        <option value="totalScore">总分</option>
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    
                    <div style="display:flex; align-items:center; margin-right:15px;">
                        <input type="checkbox" id="paper-compare-class" style="margin-right:5px; cursor:pointer;">
                        <label for="paper-compare-class" style="cursor:pointer; user-select:none; font-weight:bold; color:#007bff;">对比各班</label>
                    </div>
                    
                    <label for="paper-bin-size">分段大小:</label>
                    <input type="number" id="paper-bin-size" value="10" style="width: 60px;">
                    <button id="paper-redraw-btn" class="sidebar-button" style="width: auto; margin-left:10px;">重绘</button>
                </div>
            <div class="chart-container" id="subject-histogram-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">各科难度系数对比</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(难度 = 平均分 / 满分, 越高越简单)</span>
            </div>
            <div class="chart-container" id="difficulty-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">各科区分度对比 (标准差)</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(标准差越大, 越能拉开差距)</span>
            </div>
            <div class="chart-container" id="discrimination-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls" style="display: block;"> <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin:0;">难度-区分度 散点图</h4>
                </div>
                
                <div style="background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 10px 15px; font-size: 0.85em; color: #555;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <strong style="color: #fd7e14;">↖ 左上 (难 + 拉分)</strong>：<strong>胜负手</strong>。题目难且能拉开差距，决定尖子生排名。
                        </div>
                        <div>
                            <strong style="color: #28a745;">↗ 右上 (易 + 拉分)</strong>：<strong>黄金区</strong>。题目适中，既照顾基础又能选拔人才。
                        </div>
                        <div>
                            <strong style="color: #dc3545;">↙ 左下 (难 + 不拉分)</strong>：<strong>无效难</strong>。太难了大家都不会，无法区分水平。
                        </div>
                        <div>
                            <strong style="color: #007bff;">↘ 右下 (易 + 不拉分)</strong>：<strong>福利局</strong>。题目简单，大家分都高，不论英雄。
                        </div>
                    </div>
                    <div style="margin-top: 8px; border-top: 1px dashed #dee2e6; padding-top: 5px; color: #888;">
                        * 气泡大小代表科目满分权重 (如语数英气泡更大)。
                    </div>
                </div>
                </div>
            <div class="chart-container" id="difficulty-scatter-chart" style="width: 100%; height: 500px;"></div>
        </div>
    `;

        // 2. 绘制直方图 (升级版)
        const drawChart = () => {
        const subjectName = document.getElementById('subject-select').value;
        const binSize = parseInt(document.getElementById('paper-bin-size').value) || 10;
        // 新增：获取对比状态
        const isClassCompare = document.getElementById('paper-compare-class').checked;
        
        const s = stats[subjectName];
        if (!s) return;

        let fullScore;
        if (subjectName === 'totalScore') {
            fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
        } else {
            fullScore = G_SubjectConfigs[subjectName]?.full || 100;
        }

        // 新增：如果是对比模式，强制使用所有数据(G_StudentsData)；否则使用筛选数据(activeData)
        const sourceData = isClassCompare ? G_StudentsData : activeData;

        renderHistogram(
            'subject-histogram-chart',
            sourceData,     // 数据源
            subjectName,    // 科目Key
            fullScore,
            `${s.name} 分数段分布图 (分段=${binSize})`,
            binSize,
            isClassCompare  // 传入对比标记
        );
    };

    // 3. 绑定事件
    document.getElementById('subject-select').addEventListener('change', drawChart);
    document.getElementById('paper-redraw-btn').addEventListener('click', drawChart);
    // 新增：绑定 checkbox
    document.getElementById('paper-compare-class').addEventListener('change', drawChart);

    // 4. (    ) 绘制  图表
    renderSubjectComparisonBarChart('difficulty-chart', stats, 'difficulty');
    renderSubjectComparisonBarChart('discrimination-chart', stats, 'stdDev');
    renderDifficultyScatter('difficulty-scatter-chart', stats);

    // 5. 默认绘制总分
    drawChart('totalScore');
}


/**
 * (    ) 9.3.5. 模块：单科成绩分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 * @param {Object} stats - G_Statistics (全体统计)
 */
function renderSingleSubject(container, activeData, stats) {

    // 1. 渲染基础HTML
    container.innerHTML = `
        <h2>模块四：单科成绩分析 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="ss-subject-select">选择科目:</label>
                <select id="ss-subject-select" class="sidebar-select">
                    ${G_DynamicSubjectList.map((s, i) => `<option value="${s}" ${i === 0 ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </div>
        </div>

        <div id="ss-kpi-grid" class="kpi-grid" style="margin-bottom: 20px;"></div>

        <div class="dashboard-chart-grid-2x2">
            <div class="main-card-wrapper">
                <h4 style="margin:0;">分数段直方图</h4>
                <div class="chart-container" id="ss-histogram-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <label for="ss-class-compare-metric">对比指标:</label>
                    <select id="ss-class-compare-metric" class="sidebar-select" style="min-width: 120px;">
                        <option value="average">平均分</option>
                        <option value="passRate">及格率 (%)</option>
                        <option value="excellentRate">优秀率 (%)</option>
                        <option value="stdDev">标准差</option>
                        <option value="max">最高分</option>
                    </select>
                </div>
                <div class="chart-container" id="ss-class-compare-chart" style="height: 350px;"></div>
            </div>
        </div>

        <div class="dashboard-chart-grid-2x2" style="margin-top: 20px;">
            <div class="main-card-wrapper">
                <h4 style="margin:0;">📦 各班分化程度对比 (箱形图)</h4>
                <p style="font-size:0.8em; color:#999; margin:5px 0;">* 箱体越长表示班级内部分化越严重；圆点为异常高/低分。</p>
                <div class="chart-container" id="ss-class-boxplot" style="height: 400px;"></div>
            </div>
            <div class="main-card-wrapper">
                <h4 style="margin:0;">🎯 班级教学质量诊断 (四象限)</h4>
                <p style="font-size:0.8em; color:#999; margin:5px 0;">* X轴:及格率, Y轴:平均分。十字线为年级平均水平。</p>
                <div class="chart-container" id="ss-class-quadrant" style="height: 400px;"></div>
            </div>
        </div>

        <div class="dashboard-chart-grid-2x2" style="margin-top: 20px;">
            <div class="main-card-wrapper">
                <h4 style="margin:0;">A/B/C/D 等级构成</h4>
                <div class="chart-container" id="ss-abcd-pie-chart" style="height: 400px;"></div>
            </div>
            <div class="main-card-wrapper" style="display:flex; flex-direction:column; gap:10px;">
                <div style="flex:1; display:flex; flex-direction:column;">
                    <h4 style="margin:0;">本科目 Top 10</h4>
                    <div class="table-container" id="ss-top10-table" style="flex:1; overflow-y:auto;"></div>
                </div>
                <div style="flex:1; display:flex; flex-direction:column; border-top:1px dashed #eee; padding-top:10px;">
                    <h4 style="margin:0;">本科目 Bottom 10</h4>
                    <div class="table-container" id="ss-bottom10-table" style="flex:1; overflow-y:auto;"></div>
                </div>
            </div>
        </div>
    `;

    // 2. 内部辅助函数：用于渲染所有图表和表格
    const drawAnalysis = () => {
        const subjectName = document.getElementById('ss-subject-select').value;
        if (!subjectName) return;

        const subjectStats = stats[subjectName] || {};
        const config = G_SubjectConfigs[subjectName] || {};
        const fullScore = config.full || 100;

        // 2.1 渲染KPIs (不变)
        const kpiContainer = document.getElementById('ss-kpi-grid');
        kpiContainer.innerHTML = `
            <div class="kpi-card"><h3>平均分</h3><div class="value">${subjectStats.average || 0}</div></div>
            <div class="kpi-card"><h3>最高分</h3><div class="value">${subjectStats.max || 0}</div></div>
            <div class="kpi-card"><h3>最低分</h3><div class="value">${subjectStats.min || 0}</div></div>
            <div class="kpi-card"><h3>优秀率 (%)</h3><div class="value">${subjectStats.excellentRate || 0}</div></div>
            <div class="kpi-card"><h3>良好率 (%)</h3><div class="value">${subjectStats.goodRate || 0}</div></div>
            <div class="kpi-card"><h3>及格率 (%)</h3><div class="value">${subjectStats.passRate || 0}</div></div>
            <div class="kpi-card"><h3>不及格率 (%)</h3><div class="value">${subjectStats.failRate || 0}</div></div>
            <div class="kpi-card"><h3>标准差</h3><div class="value">${subjectStats.stdDev || 0}</div></div>
        `;

        // 2.2 渲染直方图 (不变)
        renderHistogram(
            'ss-histogram-chart',
            activeData,
            subjectName,
            fullScore,
            `${subjectName} 分数段直方图`,
            Math.round(fullScore / 15) // 动态分段，约15段
        );

        // 2.3    (  ) 渲染班级对比图
        const metricSelect = document.getElementById('ss-class-compare-metric');
        const drawClassCompareChart = () => {
            const metric = metricSelect.value;
            const chartEl = document.getElementById('ss-class-compare-chart');

            if (G_CurrentClassFilter !== 'ALL') {
                chartEl.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">请在侧边栏选择 "全体年段" 以查看班级对比。</p>`;
                return;
            }

            // (复用) 调用班级对比数据计算函数
            const data = calculateClassComparison(metric, subjectName);
            let metricName = metricSelect.options[metricSelect.selectedIndex].text;
            // (复用) 调用班级对比图渲染函数
            renderClassComparisonChart('ss-class-compare-chart', data, `各班级 - ${subjectName} ${metricName}`);
        };

        // (绑定事件)
        metricSelect.addEventListener('change', drawClassCompareChart);
        // (初始绘制)
        drawClassCompareChart();


        // 2.4    (  ) 渲染饼图
        renderSingleSubjectPie('ss-abcd-pie-chart', subjectStats);


        // 2.5 渲染 Top/Bottom 表格 (不变)
        const sortedStudents = [...activeData]
            .filter(s => s.scores[subjectName] !== null && s.scores[subjectName] !== undefined)
            .sort((a, b) => (b.scores[subjectName]) - (a.scores[subjectName]));

        const top10 = sortedStudents.slice(0, 10);
        const bottom10 = sortedStudents.slice(-10).reverse();


        const createTable = (data, rankType) => {
            let rankHeader = rankType === 'top' ? '排名' : '倒数';
            if (data.length === 0) return '<p style="text-align: center; color: var(--text-muted); padding-top: 20px;">无数据</p>';

            return `
                <table>
                    <thead>
                        <tr>
                            <th>${rankHeader}</th>
                            <th>姓名</th>
                            <th>分数</th>
                            <th>班排(总分)</th> <th>年排(单科)</th> </tr>
                    </thead>
                    <tbody>
                        ${data.map((s, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${s.name}</td>
                                <td><strong>${s.scores[subjectName]}</strong></td>
                                <td>${s.rank || '-'}</td>
                                <td>${(s.gradeRanks && s.gradeRanks[subjectName]) ? s.gradeRanks[subjectName] : '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        };

        document.getElementById('ss-top10-table').innerHTML = createTable(top10, 'top');
        document.getElementById('ss-bottom10-table').innerHTML = createTable(bottom10, 'bottom');


        // 只有在"全体"模式下才显示班级对比，否则显示提示
        const boxplotDiv = document.getElementById('ss-class-boxplot');
        const quadrantDiv = document.getElementById('ss-class-quadrant');

        if (G_CurrentClassFilter === 'ALL') {
            renderSingleSubjectClassBoxplot('ss-class-boxplot', activeData, subjectName);
            renderSingleSubjectQuadrant('ss-class-quadrant', activeData, subjectName, subjectStats);
        } else {
            boxplotDiv.innerHTML = quadrantDiv.innerHTML = `<p style="text-align:center; color:#ccc; padding-top:100px;">请选择“全体年段”以查看班级对比分析</p>`;
        }
    };

    // 3. 绑定主事件
    document.getElementById('ss-subject-select').addEventListener('change', drawAnalysis);

    // 4. 初始绘制 (默认使用列表中的第一个科目)
    drawAnalysis();
}

/**
 * [新增] 单科分析 - 各班级分数箱形图
 */
function renderSingleSubjectClassBoxplot(elementId, students, subject) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 1. 数据分组
    const classMap = {};
    students.forEach(s => {
        if (!classMap[s.class]) classMap[s.class] = [];
        const val = s.scores[subject];
        if (typeof val === 'number' && !isNaN(val)) {
            classMap[s.class].push(val);
        }
    });

    // 2. 排序班级名
    const classes = Object.keys(classMap).sort();
    
    // 3. 计算箱线数据
    const boxData = [];
    const outliers = [];

    classes.forEach((cls, idx) => {
        const scores = classMap[cls].sort((a, b) => a - b);
        if (scores.length === 0) {
            boxData.push([0,0,0,0,0]); return;
        }
        
        // 计算四分位
        const q1Val = quantile(scores, 0.25);
        const q2Val = quantile(scores, 0.5);
        const q3Val = quantile(scores, 0.75);
        const iqr = q3Val - q1Val;
        
        const minLimit = q1Val - 1.5 * iqr;
        const maxLimit = q3Val + 1.5 * iqr;

        // 过滤异常值
        const normalScores = scores.filter(s => s >= minLimit && s <= maxLimit);
        const minVal = normalScores.length > 0 ? Math.min(...normalScores) : q1Val;
        const maxVal = normalScores.length > 0 ? Math.max(...normalScores) : q3Val;

        boxData.push([minVal, q1Val, q2Val, q3Val, maxVal]);

        // 收集异常点
        scores.forEach(s => {
            if (s < minLimit || s > maxLimit) {
                outliers.push([idx, s]);
            }
        });
    });

    // 辅助：计算分位数
    function quantile(arr, q) {
        const pos = (arr.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (arr[base + 1] !== undefined) {
            return arr[base] + rest * (arr[base + 1] - arr[base]);
        } else {
            return arr[base];
        }
    }

    const option = {
        tooltip: {
            trigger: 'item',
            axisPointer: { type: 'shadow' },
            confine: true
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: classes,
            axisLabel: { rotate: 30, interval: 0 }
        },
        yAxis: {
            type: 'value',
            name: '分数',
            splitArea: { show: true }
        },
        series: [
            {
                name: '分数分布',
                type: 'boxplot',
                data: boxData,
                itemStyle: {
                    color: '#e3f2fd',
                    borderColor: '#007bff'
                },
                tooltip: {
                    formatter: function (param) {
                        return [
                            '<strong>' + param.name + '</strong>',
                            '最高分 (上须): ' + param.data[5].toFixed(1),
                            'Q3 (前25%线): ' + param.data[4].toFixed(1),
                            '中位数: ' + param.data[3].toFixed(1),
                            'Q1 (后25%线): ' + param.data[2].toFixed(1),
                            '最低分 (下须): ' + param.data[1].toFixed(1)
                        ].join('<br/>');
                    }
                }
            },
            {
                name: '异常值',
                type: 'scatter',
                data: outliers,
                itemStyle: { color: '#dc3545' },
                tooltip: {
                    formatter: (p) => `<strong>${classes[p.data[0]]}</strong><br/>异常分: ${p.data[1]}`
                }
            }
        ]
    };
    myChart.setOption(option);
}

/**
 * [新增] 单科分析 - 班级四象限诊断图
 * X轴：及格率，Y轴：平均分
 */
function renderSingleSubjectQuadrant(elementId, students, subject, gradeStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 1. 准备数据
    const classMap = {};
    const classes = [...new Set(students.map(s => s.class))].sort();
    const config = G_SubjectConfigs[subject] || { pass: 60 };

    const data = classes.map(cls => {
        const group = students.filter(s => s.class === cls);
        const scores = group.map(s => s.scores[subject]).filter(v => typeof v === 'number');
        
        if (scores.length === 0) return null;

        const avg = scores.reduce((a,b)=>a+b, 0) / scores.length;
        const passCount = scores.filter(v => v >= config.pass).length;
        const passRate = (passCount / scores.length) * 100;

        return {
            name: cls,
            value: [passRate.toFixed(1), avg.toFixed(1)], // [X, Y]
            count: scores.length
        };
    }).filter(d => d !== null);

    // 2. 基准线 (年级平均)
    const gradeAvg = gradeStats.average || 0;
    const gradePassRate = gradeStats.passRate || 0;

    // 3. 计算坐标轴范围 (为了美观，不从0开始)
    const minX = Math.min(...data.map(d => parseFloat(d.value[0])), gradePassRate) * 0.9;
    const maxX = Math.min(100, Math.max(...data.map(d => parseFloat(d.value[0])), gradePassRate) * 1.05);
    const minY = Math.min(...data.map(d => parseFloat(d.value[1])), gradeAvg) * 0.9;
    const maxY = Math.max(...data.map(d => parseFloat(d.value[1])), gradeAvg) * 1.05;

    const option = {
        tooltip: {
            trigger: 'item',
            formatter: (p) => {
                return `<strong>${p.name}</strong><br/>` +
                       `平均分: ${p.value[1]}<br/>` +
                       `及格率: ${p.value[0]}%<br/>` +
                       `人数: ${p.data.count}`;
            }
        },
        grid: { left: '10%', right: '10%', top: '10%', bottom: '10%' },
        xAxis: {
            type: 'value',
            name: '及格率 (%)',
            nameLocation: 'middle',
            nameGap: 25,
            min: Math.floor(minX),
            max: Math.ceil(maxX),
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: '平均分',
            nameLocation: 'middle',
            nameGap: 30,
            min: Math.floor(minY),
            max: Math.ceil(maxY),
            splitLine: { show: false }
        },
        series: [
            {
                type: 'scatter',
                data: data,
                symbolSize: 15,
                itemStyle: {
                    color: (p) => {
                        // 简单着色逻辑
                        const x = parseFloat(p.value[0]);
                        const y = parseFloat(p.value[1]);
                        if (x >= gradePassRate && y >= gradeAvg) return '#28a745'; // 右上: 优
                        if (x < gradePassRate && y < gradeAvg) return '#dc3545'; // 左下: 差
                        return '#ffc107'; // 中
                    },
                    shadowBlur: 5,
                    shadowColor: 'rgba(0,0,0,0.3)'
                },
                label: {
                    show: true,
                    formatter: '{b}',
                    position: 'top',
                    color: '#333',
                    fontSize: 10
                },
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { type: 'dashed', color: '#666' },
                    label: { position: 'end' },
                    data: [
                        { xAxis: gradePassRate, name: '年级及格率' },
                        { yAxis: gradeAvg, name: '年级平均分' }
                    ]
                },
                markArea: {
                    silent: true,
                    itemStyle: { opacity: 0.03 },
                    data: [
                        // 右上象限 (双高)
                        [{ xAxis: gradePassRate, yAxis: gradeAvg }, { xAxis: 100, yAxis: maxY }],
                        // 左下象限 (双低) - 红色警示
                        [{ xAxis: minX, yAxis: minY }, { xAxis: gradePassRate, yAxis: gradeAvg, itemStyle: { color: '#ff0000', opacity: 0.05 } }]
                    ]
                }
            }
        ]
    };
    myChart.setOption(option);
}
/**
 * [旗舰升级版] 模块十一：成绩趋势对比 (含班级增值评价)
 */
function renderTrend(container, currentData, compareData) {

    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块十一：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2><p style="padding:20px; color:#999;">请先在侧边栏导入 "对比成绩" 数据。</p>`;
        return;
    }

    // 1. 数据预处理：合并新旧数据
    const mergedData = currentData.map(student => {
        const oldStudent = compareData.find(s => String(s.id) === String(student.id));
        
        // 预计算差异
        let rankDiff = null;
        let gradeRankDiff = null;
        let scoreDiff = null;

        if (oldStudent) {
            if (student.totalScore !== null && oldStudent.totalScore !== null) {
                scoreDiff = parseFloat((student.totalScore - oldStudent.totalScore).toFixed(2));
            }
            if (student.rank !== null && oldStudent.rank !== null) {
                rankDiff = oldStudent.rank - student.rank;
            }
            if (student.gradeRank !== null && oldStudent.gradeRank !== null) {
                gradeRankDiff = oldStudent.gradeRank - student.gradeRank;
            }
        }

        return {
            ...student,
            oldFound: !!oldStudent,
            oldTotalScore: oldStudent ? oldStudent.totalScore : null,
            oldRank: oldStudent ? oldStudent.rank : null,
            oldGradeRank: oldStudent ? oldStudent.gradeRank : null,
            scoreDiff: scoreDiff,
            rankDiff: rankDiff,
            gradeRankDiff: gradeRankDiff,
            oldScores: oldStudent ? (oldStudent.scores || {}) : {},
            oldClassRanks: oldStudent ? (oldStudent.classRanks || {}) : {},
            oldGradeRanks: oldStudent ? (oldStudent.gradeRanks || {}) : {}
        };
    });

    // 2. 渲染 HTML 框架
    container.innerHTML = `
        <h2>模块十一：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="controls-bar chart-controls" style="flex-wrap: wrap; margin-bottom: 20px;">
            <label for="trend-subject-select" style="font-weight:bold;">分析对象:</label>
            <select id="trend-subject-select" class="sidebar-select" style="min-width: 120px; margin-right: 15px; color: #6f42c1; font-weight: bold;">
                <option value="totalScore">总分</option>
                ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>

            <label for="trend-class-filter">班级:</label>
            <select id="trend-class-filter" class="sidebar-select" style="min-width: 120px;">
                <option value="ALL">-- 全体年段 --</option>
                ${[...new Set(currentData.map(s => s.class))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px; border-left: 5px solid #fd7e14;">
            <h4 style="margin: 0 0 10px 0; color: #fd7e14;">📊 班级增值评价 (Value-Added)</h4>
            <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">
                <strong>“低进高出”即为增值。</strong><br>
                X轴：上次排名 (上次考试平均年排，越靠右生源越差)；Y轴：增值幅度。<br>
                <span style="color:#28a745">● 第一象限 (排名差，进步大)</span>
                <span style="color:#dc3545">● 第四象限 (排名差，退步)</span>
                <span style="color:#007bff">● 第二象限 (排名高，进步)</span>
                <span style="color:#6c757d">● 第三象限 (排名高，退步)</span>
            </p>
            <div class="chart-container" id="trend-class-value-added-chart" style="height: 450px;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h4 style="margin:0;">学生个体进退步详情</h4>
                <div style="display:flex; align-items:center;">
                    <label for="trend-sort-filter" style="margin-right:5px; font-size:0.9em;">排序:</label>
                    <select id="trend-sort-filter" class="sidebar-select" style="width: 160px;">
                        <option value="name">按姓名</option>
                        <option value="rankDiff_desc">按 班排进步 (大到小)</option>
                        <option value="gradeRankDiff_desc">按 年排进步 (大到小)</option>
                    </select>
                </div>
            </div>
            <div class="chart-container" id="trend-rank-change-bar-chart" style="height: 350px;"></div>
        </div>

        <div class="main-card-wrapper">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0 0 15px 0; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center;">
                    <label for="trend-search">搜索:</label>
                    <input type="text" id="trend-search" placeholder="姓名/考号..." class="sidebar-select" style="width:150px;">
                </div>
                <span id="trend-table-status" style="font-size:0.85em; color:#20c997; font-weight:bold;">* 联动显示总分</span>
            </div>

            <div class="table-container" style="max-height: 600px; overflow-y: auto;">
                <table>
                    <thead id="trend-table-header">
                        <tr>
                            <th data-sort-key="id" style="cursor:pointer;">考号 ⇅</th>
                            <th data-sort-key="name" style="cursor:pointer;">姓名 ⇅</th>
                            <th data-sort-key="currentVal" style="cursor:pointer;" id="th-trend-score">总分 ⇅</th>
                            <th data-sort-key="diffVal" style="cursor:pointer;">分差 ⇅</th>
                            <th data-sort-key="currentCR" style="cursor:pointer;" id="th-trend-cr">班排 ⇅</th>
                            <th data-sort-key="diffCR" style="cursor:pointer;">班排变 ⇅</th>
                            <th data-sort-key="currentGR" style="cursor:pointer;" id="th-trend-gr">年排 ⇅</th>
                            <th data-sort-key="diffGR" style="cursor:pointer;">年排变 ⇅</th>
                        </tr>
                    </thead>
                    <tbody id="trend-table-body"></tbody>
                </table>
            </div>
        </div>
    `;

    // 3. 核心逻辑：动态计算当前科目
    const getDisplayData = () => {
        const subject = document.getElementById('trend-subject-select').value;
        const isTotal = subject === 'totalScore';

        return mergedData.map(s => {
            let currentVal, oldVal, currentCR, oldCR, currentGR, oldGR;
            
            if (isTotal) {
                currentVal = s.totalScore; oldVal = s.oldTotalScore;
                currentCR = s.rank; oldCR = s.oldRank;
                currentGR = s.gradeRank; oldGR = s.oldGradeRank;
            } else {
                currentVal = s.scores[subject]; oldVal = s.oldScores[subject];
                currentCR = s.classRanks ? s.classRanks[subject] : null;
                oldCR = s.oldClassRanks ? s.oldClassRanks[subject] : null;
                currentGR = s.gradeRanks ? s.gradeRanks[subject] : null;
                oldGR = s.oldGradeRanks ? s.oldGradeRanks[subject] : null;
            }

            let diffVal = (currentVal !== null && oldVal !== null) ? (currentVal - oldVal) : null;
            let diffCR = (currentCR !== null && oldCR !== null) ? (oldCR - currentCR) : null; 
            let diffGR = (currentGR !== null && oldGR !== null) ? (oldGR - currentGR) : null;

            return {
                raw: s, id: s.id, name: s.name, class: s.class,
                currentVal, oldVal, diffVal,
                currentCR, oldCR, diffCR,
                currentGR, oldGR, diffGR,
                // 辅助字段：用于增值计算
                validGradeChange: (currentGR !== null && oldGR !== null)
            };
        });
    };

    // 4. 🔥 绘制 增值评价图 (上帝视角修复版) 🔥
    const drawValueAddedChart = () => {
        const subject = document.getElementById('trend-subject-select').value;
        const subjectLabel = (subject === 'totalScore') ? '总分' : subject;
        const currentFilterClass = document.getElementById('trend-class-filter').value;

        // 🔥 关键：强制使用全局数据 G_StudentsData 计算班级指标，不受筛选影响
        const globalClassMap = {};
        
        G_StudentsData.forEach(s => {
            // 找到旧数据
            const oldS = G_CompareData.find(o => String(o.id) === String(s.id));
            if (!globalClassMap[s.class]) globalClassMap[s.class] = { name: s.class, sumOldRank: 0, sumChange: 0, count: 0 };
            
            // 计算单科/总分排名变化
            let oldR = null, newR = null;
            if (subject === 'totalScore') {
                if (s.gradeRank && oldS && oldS.gradeRank) { oldR = oldS.gradeRank; newR = s.gradeRank; }
            } else {
                // 确保单科排名存在
                if (s.gradeRanks && s.gradeRanks[subject] && oldS && oldS.gradeRanks && oldS.gradeRanks[subject]) {
                    oldR = oldS.gradeRanks[subject];
                    newR = s.gradeRanks[subject];
                }
            }

            if (oldR !== null && newR !== null) {
                globalClassMap[s.class].sumOldRank += oldR;
                globalClassMap[s.class].sumChange += (oldR - newR); // 正数=进步
                globalClassMap[s.class].count++;
            }
        });

        const chartData = [];
        const missingClasses = [];

        // 获取所有班级列表
        const allClasses = [...new Set(G_StudentsData.map(s => s.class))].sort();
        
        allClasses.forEach(cls => {
            const c = globalClassMap[cls];
            if (c && c.count > 0) {
                // 🔥 防重叠抖动 (Jitter)：加一个极小的随机数 (-0.05 ~ 0.05)
                // 这样即使两个班数据完全一样，也能错开显示
                const jitterX = (Math.random() - 0.5) * 0.1; 
                const jitterY = (Math.random() - 0.5) * 0.1;

                chartData.push({
                    name: cls,
                    x: parseFloat((c.sumOldRank / c.count).toFixed(1)) + jitterX,
                    y: parseFloat((c.sumChange / c.count).toFixed(1)) + jitterY,
                    count: c.count,
                    isHighlight: (currentFilterClass === 'ALL' || currentFilterClass === cls) // 标记高亮
                });
            } else {
                missingClasses.push(cls);
            }
        });

        let subTitle = "";
        if (missingClasses.length > 0) subTitle = `⚠️ [${missingClasses.join(', ')}] 因缺数据未显示`;

        // 调用绘图 (传入高亮标记)
        renderClassValueAddedChart('trend-class-value-added-chart', chartData, subjectLabel, subTitle);
    };

    // 5. 渲染表格
    const drawTable = () => {
        const subject = document.getElementById('trend-subject-select').value;
        const subjectLabel = (subject === 'totalScore') ? '总分' : subject;
        const searchTerm = document.getElementById('trend-search').value.toLowerCase();
        const selectedClass = document.getElementById('trend-class-filter').value;

        document.getElementById('th-trend-score').innerText = `${subjectLabel} ⇅`;
        document.getElementById('th-trend-cr').innerText = `${subjectLabel}班排 ⇅`;
        document.getElementById('th-trend-gr').innerText = `${subjectLabel}年排 ⇅`;
        document.getElementById('trend-table-status').innerText = `* 已联动显示“${subjectLabel}”数据`;

        let data = getDisplayData();

        data = data.filter(item => {
            if (selectedClass !== 'ALL' && item.class !== selectedClass) return false;
            if (searchTerm && !item.name.toLowerCase().includes(searchTerm) && !String(item.id).includes(searchTerm)) return false;
            return true;
        });

        const { key, direction } = G_TrendSort; 
        data.sort((a, b) => {
            let valA = a[key], valB = b[key];
            if (valA == null) valA = direction === 'asc' ? 99999 : -99999;
            if (valB == null) valB = direction === 'asc' ? 99999 : -99999;
            if (typeof valA === 'string') return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            return direction === 'asc' ? valA - valB : valB - valA;
        });

        const tbody = document.getElementById('trend-table-body');
        if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">无数据</td></tr>`; return; }

        tbody.innerHTML = data.map(row => {
            const formatDiff = (val) => {
                if (val == null) return '<span style="color:#ccc">-</span>';
                if (val === 0) return `<span style="color:#999;">0</span>`;
                if (val > 0) return `<span class="progress">▲ ${val}</span>`;
                return `<span class="regress">▼ ${Math.abs(val)}</span>`;
            };
            const formatScoreDiff = (val) => {
                 if (val == null) return '<span style="color:#ccc">-</span>';
                 if (val === 0) return `<span style="color:#999;">0</span>`;
                 if (val > 0) return `<span class="progress">▲ +${val.toFixed(1)}</span>`;
                 return `<span class="regress">▼ ${val.toFixed(1)}</span>`;
            };

            return `
                <tr>
                    <td>${row.id}</td><td><strong>${row.name}</strong></td>
                    <td><strong>${row.currentVal ?? '-'}</strong> <span style="font-size:0.8em; color:#999;">(前:${row.oldVal ?? '-'})</span></td>
                    <td>${formatScoreDiff(row.diffVal)}</td>
                    <td><strong>${row.currentCR ?? '-'}</strong></td><td>${formatDiff(row.diffCR)}</td>
                    <td>${row.currentGR ?? '-'}</td><td>${formatDiff(row.diffGR)}</td>
                </tr>
            `;
        }).join('');
    };

    // 6. 绘制个体柱状图
    const drawCharts = () => {
        const classFilter = document.getElementById('trend-class-filter').value;
        const sortFilter = document.getElementById('trend-sort-filter').value;
        const subject = document.getElementById('trend-subject-select').value;
        
        let chartSource = mergedData;
        if (classFilter !== 'ALL') chartSource = mergedData.filter(s => s.class === classFilter);
        
        renderRankChangeBarChart('trend-rank-change-bar-chart', chartSource, sortFilter, subject);
    };

    // 7. 绑定事件
    const subjectSelect = document.getElementById('trend-subject-select');
    const classSelect = document.getElementById('trend-class-filter');
    const sortSelect = document.getElementById('trend-sort-filter');
    const searchInput = document.getElementById('trend-search');
    const tableHead = document.getElementById('trend-table-header');

    const refreshAll = () => { drawValueAddedChart(); drawCharts(); drawTable(); };

    subjectSelect.addEventListener('change', refreshAll);
    classSelect.addEventListener('change', refreshAll);
    sortSelect.addEventListener('change', drawCharts);
    searchInput.addEventListener('input', drawTable);

    tableHead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;
        const newKey = th.dataset.sortKey;
        if (newKey === G_TrendSort.key) G_TrendSort.direction = (G_TrendSort.direction === 'asc') ? 'desc' : 'asc';
        else { G_TrendSort.key = newKey; G_TrendSort.direction = ['diffVal','diffCR','diffGR'].includes(newKey) ? 'desc' : 'asc'; }
        
        tableHead.querySelectorAll('th').forEach(h => h.style.color = '');
        th.style.color = '#007bff';
        drawTable();
    });

    // 8. 初始化
    G_TrendSort = { key: 'diffGR', direction: 'desc' }; // 默认按年排进步排序
    refreshAll();
}

/**
 * [完整版] 绘制班级增值评价散点图 (四象限带标签)
 * @param {string} elementId - DOM 容器 ID
 * @param {Array} data - 数据数组 [{name: '1班', x: 120, y: 5, count: 45}, ...]
 * @param {string} subjectName - 科目名称
 * @param {string} subTitle - (可选) 副标题，用于显示缺失班级提示
 */

/**
 * [旗舰完整版] 绘制班级增值评价散点图
 * - 特性1：支持高亮选中班级 (UI 优化)
 * - 特性2：Tooltip 显示详细数据且保留有效数字 (toFixed修复)
 */
function renderClassValueAddedChart(elementId, data, subjectName, subTitle = "") {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    if (!data || data.length === 0) {
        chartDom.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#999;">暂无有效增值数据 (需同时拥有两次考试的排名)</div>`;
        return;
    }

    // 定义颜色
    const colors = { Q1: '#28a745', Q2: '#007bff', Q3: '#ffc107', Q4: '#dc3545' };

    // 1. 计算坐标轴范围
    const xValues = data.map(d => d.x);
// 动态计算 X 轴范围，避免点贴在边缘 (并向下/向上取整，去除小数)
    const minX = Math.floor(Math.min(...xValues) * 0.9);
    const maxX = Math.ceil(Math.max(...xValues) * 1.1);
    const avgEntryRank = xValues.reduce((a,b)=>a+b,0) / xValues.length;

    // 2. 准备 Series Data (带高亮逻辑)
    const seriesData = data.map(item => ({
        name: item.name,
        value: [item.x, item.y, item.count],
        // 高亮逻辑：选中的不透明，未选中的半透明
        itemStyle: { 
            shadowBlur: item.isHighlight ? 20 : 0, 
            shadowColor: 'rgba(0,0,0,0.5)',
            opacity: item.isHighlight ? 1 : 0.2, 
            borderColor: item.isHighlight ? '#000' : null,
            borderWidth: item.isHighlight ? 1 : 0
        },
        label: {
            show: true,
            formatter: '{b}',
            position: 'top',
            color: item.isHighlight ? '#333' : '#ccc',
            fontWeight: item.isHighlight ? 'bold' : 'normal'
        }
    }));

    // 3. ECharts 配置
    const option = {
        title: {
            text: `${subjectName} - 班级增值四象限 (全校视角)`,
            subtext: subTitle,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' },
            subtextStyle: { color: '#f56c6c' }
        },
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255,255,255,0.95)',
            formatter: (params) => {
                if (params.componentType !== 'series') return;
                
                const d = params.data;
                const entryRank = d.value[0];
                const progress = d.value[1];

                // 🔥 修复点：强制保留小数位，防止显示过长 🔥
                const progressFixed = parseFloat(progress).toFixed(2);
                const entryRankFixed = parseFloat(entryRank).toFixed(1);
                
                // 判断象限
                let type = "";
                if (progress >= 0) {
                    type = entryRank >= avgEntryRank ? "🌟 逆袭班级 (排名弱, 进步大)" : "💪 培优班级 (排名强, 进步大)";
                } else {
                    type = entryRank >= avgEntryRank ? "⚠️ 低效区 (排名弱, 且退步)" : "📉 警示区 (排名强, 但退步)";
                }

                // 返回详细的 HTML 结构
                return `<strong>${d.name}</strong><br/>` +
                       `上次排名: 年排 ${entryRankFixed}<br/>` +
                       `本次增值: <strong style="color:${progress>=0?'#28a745':'#dc3545'}">${progress>0?'+':''}${progressFixed} 名</strong><br/>` +
                       `参评人数: ${d.value[2]}<br/>` +
                       `<hr style="margin:5px 0;border-color:#eee"/>${type}`;
            }
        },
        grid: { left: '8%', right: '12%', bottom: '10%', top: '18%', containLabel: true },
        xAxis: {
            type: 'value', name: '上次排名 (排名越大越弱 →)', nameLocation: 'middle', nameGap: 30,
            min: minX, max: maxX, scale: true, splitLine: { show: false }, axisLine: { symbol: ['none', 'arrow'] }
        },
        yAxis: {
            type: 'value', name: '教学增值 (进步名次 ↑)', nameLocation: 'middle', nameGap: 40,
            scale: true, splitLine: { show: false }, axisLine: { symbol: ['none', 'arrow'] }
        },
        series: [
            {
                type: 'scatter',
                data: seriesData,
                symbolSize: (val) => Math.max(15, Math.min(50, val[2])),
                itemStyle: {
                    // 动态计算气泡颜色
                    color: (params) => {
                        const [x, y] = params.value;
                        if (x >= avgEntryRank && y >= 0) return colors.Q1;
                        if (x < avgEntryRank && y >= 0) return colors.Q2;
                        if (x < avgEntryRank && y < 0) return colors.Q3;
                        return colors.Q4;
                    }
                },
                markLine: {
                    silent: true, symbol: 'none', lineStyle: { color: '#333', width: 2, type: 'dashed' },
                    data: [
                        { xAxis: avgEntryRank, name: '平均生源线' },
                        { yAxis: 0, name: '零增值线' }
                    ]
                },
                markArea: {
                    silent: true, itemStyle: { opacity: 0.08 },
                    data: [
                        [{ xAxis: avgEntryRank, yAxis: 0, itemStyle: {color: colors.Q1} }, { xAxis: 99999, yAxis: 99999 }],
                        [{ xAxis: -99999, yAxis: 0, itemStyle: {color: colors.Q2} }, { xAxis: avgEntryRank, yAxis: 99999 }],
                        [{ xAxis: -99999, yAxis: -99999, itemStyle: {color: colors.Q3} }, { xAxis: avgEntryRank, yAxis: 0 }],
                        [{ xAxis: avgEntryRank, yAxis: -99999, itemStyle: {color: colors.Q4} }, { xAxis: 99999, yAxis: 0 }]
                    ]
                }
            }
        ]
    };

    myChart.setOption(option);
    
    // 动态添加四角标签
    setTimeout(() => {
        myChart.setOption({
            graphic: [
                { type: 'text', right: '5%', top: '20%', style: { text: '🌟 逆袭区', fill: colors.Q1, font: 'bold 14px sans-serif' } },
                { type: 'text', left: '10%', top: '20%', style: { text: '💪 培优区', fill: colors.Q2, font: 'bold 14px sans-serif' } },
                { type: 'text', left: '10%', bottom: '15%', style: { text: '📉 警示区', fill: colors.Q3, font: 'bold 14px sans-serif' } },
                { type: 'text', right: '5%', bottom: '15%', style: { text: '⚠️ 低效区', fill: colors.Q4, font: 'bold 14px sans-serif' } }
            ]
        });
    }, 100);
}

/**
 * 9.5. 模块五：学生分层筛选
 *    (关键) A/B/C/D 快捷按钮现在从 config.good 读取
 */
function renderGroups(container, students) {
    // 1.   渲染筛选器卡片
    container.innerHTML = `
        <h2>模块八：学生分层筛选 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; margin-bottom: 0; flex-wrap: wrap;">
                <label for="group-subject">筛选科目:</label>
                <select id="group-subject" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <input type="number" id="group-min" placeholder="最低分" value="0">
                <label for="group-max"> <= 分数 <= </label>
                <input type="number" id="group-max" placeholder="最高分" value="900">
                <button id="group-filter-btn" class="sidebar-button">筛选</button>
            </div>
            
            <div class="shortcut-btn-group">
                <label style="font-size: 0.9em; color: var(--text-muted); align-self: center;">快捷方式:</label>
                <button class="shortcut-btn" data-type="A">A (优秀)</button>
                <button class="shortcut-btn" data-type="B">B (良好)</button>
                <button class="shortcut-btn" data-type="C">C (及格)</button>
                <button class="shortcut-btn" data-type="D">D (不及格)</button>
            </div>
        </div>

        <div class="main-card-wrapper" id="group-results-wrapper" style="display: none;">
            
            <div id="group-results-table"></div>

            <div class="dashboard-chart-grid-2x2" style="margin-top: 20px;">
                <div class="main-card-wrapper" style="padding: 10px;">
                    <h4 style="margin:0 0 10px 0; text-align:center;">🥧 筛选群体的班级构成</h4>
                    <div class="chart-container" id="group-class-pie-chart" style="height: 350px;"></div>
                </div>
                <div class="main-card-wrapper" style="padding: 10px;">
                    <h4 style="margin:0 0 10px 0; text-align:center;">🕸️ 群体能力 vs 全体平均</h4>
                    <p style="font-size:0.8em; color:#999; text-align:center; margin:0;">(基于各科得分率/难度系数对比)</p>
                    <div class="chart-container" id="group-radar-chart" style="height: 350px;"></div>
                </div>
            </div>

        </div>
    `;

    // 2. 绑定事件
    const subjectSelect = document.getElementById('group-subject');
    const minInput = document.getElementById('group-min');
    const maxInput = document.getElementById('group-max');
    const filterBtn = document.getElementById('group-filter-btn');
    const resultsWrapper = document.getElementById('group-results-wrapper');
    const tableEl = document.getElementById('group-results-table');
    const shortcutBtns = document.querySelectorAll('.shortcut-btn');

    // 3. (    ) 快捷按钮事件
    shortcutBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const subject = subjectSelect.value;
            let config;
            let min = 0, max = 0;

            if (subject === 'totalScore') {
                const full = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
                const excel = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.excel || 0), 0);
                const good = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.good || 0), 0);
                const pass = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.pass || 0), 0);
                config = { full: full, excel: excel, good: good, pass: pass };
            } else {
                config = G_SubjectConfigs[subject];
            }

            //    核心修正：从配置中读取可定义的 "良好线"
            const goodLine = config.good;

            switch (type) {
                case 'A': min = config.excel; max = config.full; break;
                case 'B': min = goodLine; max = config.excel; break;
                case 'C': min = config.pass; max = goodLine; break;
                case 'D': min = 0; max = config.pass; break;
            }

            minInput.value = Math.floor(min);
            maxInput.value = Math.ceil(max);
        });
    });

// 4.   筛选按钮事件 (核心)
    filterBtn.addEventListener('click', () => {
        const subject = subjectSelect.value;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);

        const filteredStudents = students.filter(s => {
            const score = (subject === 'totalScore') ? s.totalScore : s.scores[subject];
            return score >= min && score <= max;
        });

        resultsWrapper.style.display = 'block';

        // 4.1 渲染表格 (保留原代码，这里简写)
        if (filteredStudents.length === 0) {
            tableEl.innerHTML = `<p>在 ${min} - ${max} 分数段内没有找到学生。</p>`;
            // 清空图表
            document.getElementById('group-class-pie-chart').innerHTML = '';
            document.getElementById('group-radar-chart').innerHTML = '';
            return;
        }

        tableEl.innerHTML = `
            <h4>筛选结果 (共 ${filteredStudents.length} 人)</h4>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>班排</th>
                            <th>姓名</th>
                            <th>考号</th>
                            <th>${subject === 'totalScore' ? '总分' : subject}</th>
                            <th>年排</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredStudents.map(s => `
                        <tr>
                            <td>${s.rank}</td>
                            <td>${s.name}</td>
                            <td>${s.id}</td>
                            <td><strong>${subject === 'totalScore' ? s.totalScore : s.scores[subject]}</strong></td>
                            <td>${s.gradeRank || 'N/A'}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

       // 🔥 新增：渲染两个分析图表
        renderGroupClassPie('group-class-pie-chart', filteredStudents);

        // [修复] 确保传入有效的全体统计数据
        // 如果 G_Statistics 为空（还没计算过），则现场用所有学生数据算一次
        let globalStats = G_Statistics;
        if (!globalStats || Object.keys(globalStats).length === 0) {
            // 假设你已经定义了 G_StudentsData 和 calculateAllStatistics
            if (typeof G_StudentsData !== 'undefined' && typeof calculateAllStatistics === 'function') {
                globalStats = calculateAllStatistics(G_StudentsData);
            } else {
                globalStats = {}; // 最后的保底，防止报错
            }
        }
        
        renderGroupRadarChart('group-radar-chart', filteredStudents, globalStats);
    });
}


/**
 * [新增] 模块八：筛选结果 - 班级构成饼图
 * 展示筛选出来的这批人，主要分布在哪些班级
 */
function renderGroupClassPie(elementId, filteredStudents) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 统计班级
    const classCounts = {};
    filteredStudents.forEach(student => {
        classCounts[student.class] = (classCounts[student.class] || 0) + 1;
    });

    // 2. 转换为 ECharts 数据
    const pieData = Object.keys(classCounts).map(className => {
        return {
            value: classCounts[className],
            name: className
        };
    }).sort((a, b) => b.value - a.value); // (按人数降序)

    const option = {
        title: {
            text: '筛选群体的班级构成',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c}人 ({d}%)'
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            top: 'middle',
            type: 'scroll',
            data: pieData.map(d => d.name)
        },
        series: [{
            name: '班级',
            type: 'pie',
            radius: ['40%', '70%'], // (空心圆，更现代)
            center: ['65%', '55%'], // (饼图靠右, 为图例腾空间)
            data: pieData,
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            },
            label: {
                show: true,
                formatter: '{c}人', // 饼图上直接显示人数
                position: 'outside'
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * [新增] 模块八：筛选结果 - 群体能力雷达图
 * (对比 "筛选群体" vs "全体平均" 的得分率)
 */
function renderGroupRadarChart(elementId, filteredStudents, totalStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. (关键) 重新计算这个 "筛选群体" 的统计数据
    // 我们复用 calculateAllStatistics 函数来获得该群体的平均分
    const groupStats = calculateAllStatistics(filteredStudents);

    // 2. 准备雷达图指示器
    // 为了消除各科满分不同的影响，我们统一使用“得分率/难度系数” (Score / FullScore)
    // 如果没有配置难度系数，可以用 Average / Full 计算
    const indicators = G_DynamicSubjectList.map(subject => {
        return { name: subject, max: 1.0 }; // 满分率均为 1.0
    });

    // 3. 获取 "筛选群体" 的得分率
    const groupData = G_DynamicSubjectList.map(subject => {
        const stats = groupStats[subject];
        // 难度 = 平均分 / 满分。如果 groupStats 里没有 difficulty 属性，我们手动算
        if (stats && stats.difficulty !== undefined) return stats.difficulty;
        if (stats && G_SubjectConfigs[subject]) return stats.average / G_SubjectConfigs[subject].full;
        return 0;
    });

    // 4. 获取 "全体平均" 的得分率
    const totalData = G_DynamicSubjectList.map(subject => {
        const stats = totalStats[subject];
        if (stats && stats.difficulty !== undefined) return stats.difficulty;
        if (stats && G_SubjectConfigs[subject]) return stats.average / G_SubjectConfigs[subject].full;
        return 0;
    });

    const option = {
        title: {
            text: '群体能力 vs 全体平均',
            subtext: '(指标: 得分率/难度)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: { trigger: 'item' },
        legend: {
            data: ['筛选群体', '全体平均'],
            bottom: 10
        },
        radar: {
            indicator: indicators,
            radius: '65%',
            splitArea: {
                areaStyle: {
                    color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
                }
            }
        },
        series: [{
            name: '群体 vs 全体',
            type: 'radar',
            data: [
                {
                    value: groupData,
                    name: '筛选群体',
                    areaStyle: { opacity: 0.4, color: '#28a745' }, // 绿色代表选出来的（通常是优秀的）
                    itemStyle: { color: '#28a745' },
                    lineStyle: { color: '#28a745' }
                },
                {
                    value: totalData,
                    name: '全体平均',
                    areaStyle: { opacity: 0.2, color: '#007bff' }, // 蓝色代表基准
                    itemStyle: { color: '#007bff' },
                    lineStyle: { color: '#007bff' }
                }
            ]
        }]
    };
    echartsInstances[elementId].setOption(option);
}
/**
 * [重构版] 9.6. 模块九：学科关联矩阵 (主入口)
 * - 统一计算相关系数矩阵
 * - 渲染热力图、网络图、影响力排行
 */
function renderCorrelation(container, activeData) {
    // 1. 渲染基础 HTML
    container.innerHTML = `
        <h2>模块九：学科关联矩阵 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            探索学科间的隐性关联。相关系数越接近 1，说明两科成绩“同进退”的趋势越强。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4 style="margin:0;">🔥 全科相关系数热力图</h4>
            <div class="chart-container" id="correlation-heatmap-chart" style="width: 100%; height: 600px;"></div>
        </div>

        <div class="dashboard-chart-grid-2x2" style="margin-bottom: 20px;">
            <div class="main-card-wrapper">
                <h4 style="margin:0;">🕸️ 学科“引力”网络拓扑图</h4>
                <p style="font-size:0.8em; color:#999; margin:5px 0;">* 线条越粗代表关联越强。抱团的科目通常需要相似的思维能力。</p>
                <div class="chart-container" id="correlation-network-chart" style="height: 450px;"></div>
            </div>
            <div class="main-card-wrapper">
                <h4 style="margin:0;">👑 学科“核心影响力”排行</h4>
                <p style="font-size:0.8em; color:#999; margin:5px 0;">* 核心度 = 该科与其他所有科目相关性的均值。分值越高，代表该科越能反映综合实力。</p>
                <div class="chart-container" id="correlation-centrality-chart" style="height: 450px;"></div>
            </div>
        </div>
    `;

    // 2. [核心] 统一计算矩阵数据
    const subjects = G_DynamicSubjectList;
    const n = subjects.length;
    
    // 准备数据结构
    // matrix: 二维数组，存储相关系数
    // nodes: 学科节点
    // links: 强相关连线
    // centrality: 核心度数组
    const matrix = Array(n).fill(0).map(() => Array(n).fill(0));
    const links = [];
    const centrality = subjects.map(sub => ({ name: sub, totalR: 0, count: 0 }));

    // 预处理：提取所有分数，减少循环内的 map 操作
    const scoresCache = {};
    subjects.forEach(sub => {
        scoresCache[sub] = [];
    });
    activeData.forEach(s => {
        subjects.forEach(sub => {
            // 只有当两个科目都有分时，才计入成对数据
            if (s.scores[sub] !== undefined && s.scores[sub] !== null) {
                scoresCache[sub].push(s.scores[sub]); // 这里暂存，后续成对处理时需要对齐索引
            }
        });
    });

    // 双重循环计算矩阵
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) {
                matrix[i][j] = 1.0;
            } else if (i < j) {
                const subA = subjects[i];
                const subB = subjects[j];

                // 提取成对有效数据 (Pairwise Deletion)
                const pairsA = [];
                const pairsB = [];
                
                activeData.forEach(s => {
                    const valA = s.scores[subA];
                    const valB = s.scores[subB];
                    if (typeof valA === 'number' && typeof valB === 'number') {
                        pairsA.push(valA);
                        pairsB.push(valB);
                    }
                });

                const r = calculateCorrelation(pairsA, pairsB); // 使用现有的辅助函数
                const rVal = parseFloat(r.toFixed(2));

                matrix[i][j] = rVal;
                matrix[j][i] = rVal; // 对称

                // 收集网络图连线 (只保留正相关且有一定强度的，例如 > 0.3)
                if (rVal > 0.35) {
                    links.push({
                        source: subA,
                        target: subB,
                        value: rVal,
                        lineStyle: {
                            width: (rVal - 0.3) * 5, // 动态线宽
                            opacity: 0.6 + (rVal * 0.4)
                        }
                    });
                }

                // 累加核心度
                centrality[i].totalR += rVal;
                centrality[i].count++;
                centrality[j].totalR += rVal;
                centrality[j].count++;
            }
        }
    }

    // 3. 调用各子图表渲染函数
    // (1) 热力图 (复用逻辑，但直接传矩阵数据，避免重复算)
    renderCorrelationHeatmapV2('correlation-heatmap-chart', subjects, matrix);
    
    // (2) 网络图
    renderCorrelationNetwork('correlation-network-chart', subjects, links);

    // (3) 影响力排行
    renderSubjectCentrality('correlation-centrality-chart', centrality);
}

/**
 * [优化版] 渲染热力图 (直接接收矩阵数据)
 */
function renderCorrelationHeatmapV2(elementId, subjects, matrix) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 转换为 ECharts 格式 [x, y, value]
    const data = [];
    for (let i = 0; i < subjects.length; i++) {
        for (let j = 0; j < subjects.length; j++) {
            data.push([i, j, matrix[i][j]]);
        }
    }

    const option = {
        tooltip: {
            position: 'top',
            formatter: (p) => `${subjects[p.data[0]]} vs ${subjects[p.data[1]]}<br/>相关系数: <strong>${p.data[2]}</strong>`
        },
        grid: { height: '80%', top: '5%' },
        xAxis: { type: 'category', data: subjects, splitArea: { show: true }, axisLabel: { rotate: 30 } },
        yAxis: { type: 'category', data: subjects, splitArea: { show: true } },
        visualMap: {
            min: -0.2, max: 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center', bottom: 0,
            inRange: { color: ['#f5f5f5', '#e0f3f8', '#4575b4'] } // 浅灰 -> 蓝
        },
        series: [{
            name: '相关系数',
            type: 'heatmap',
            data: data,
            label: { show: true, color: '#333' },
            itemStyle: {
                borderColor: '#fff',
                borderWidth: 1
            }
        }]
    };
    myChart.setOption(option);
}

/**
 * [新增] 模块九：学科引力网络图
 */
function renderCorrelationNetwork(elementId, subjects, links) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 构建节点
    const nodes = subjects.map((sub, idx) => ({
        name: sub,
        symbolSize: 30,
        itemStyle: {
            color: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'][idx % 8]
        },
        label: { show: true, fontSize: 11 }
    }));

    const option = {
        tooltip: { formatter: '{b}' }, // 简化提示
        series: [{
            type: 'graph',
            layout: 'force',
            data: nodes,
            links: links,
            roam: true,
            label: { position: 'right', formatter: '{b}' },
            force: {
                repulsion: 400, // 斥力
                edgeLength: [50, 200] // 边的长度范围，相关性强的会被拉近
            },
            lineStyle: {
                color: 'source',
                curveness: 0.1
            },
            emphasis: {
                focus: 'adjacency',
                lineStyle: { width: 5 }
            }
        }]
    };
    myChart.setOption(option);
}

/**
 * [新增] 模块九：学科核心影响力排行
 */
function renderSubjectCentrality(elementId, centralityData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 计算平均值并排序
    const data = centralityData.map(item => ({
        name: item.name,
        value: item.count > 0 ? parseFloat((item.totalR / item.count).toFixed(3)) : 0
    })).sort((a, b) => a.value - b.value); // 升序，因为条形图从下往上画

    const option = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: '{b}<br/>平均相关系数: {c}'
        },
        grid: { left: '3%', right: '4%', bottom: '3%', top: '5%', containLabel: true },
        xAxis: { type: 'value', name: '平均相关系数' },
        yAxis: { type: 'category', data: data.map(d => d.name) },
        series: [{
            type: 'bar',
            data: data.map(d => d.value),
            label: { show: true, position: 'right' },
            itemStyle: {
                color: (p) => {
                    // 颜色渐变：越核心颜色越深
                    // 简单处理：前3名用深色
                    const rank = data.length - 1 - p.dataIndex; // 0是第一名
                    if (rank < 3) return '#d35400'; // 核心科目 (橙红)
                    return '#87cefa'; // 普通科目 (淡蓝)
                },
                borderRadius: [0, 4, 4, 0]
            },
            barWidth: '60%'
        }]
    };
    myChart.setOption(option);
}

/**
 * (修改后) 9.7. 模块七：学生偏科诊断
 */
function renderWeakness(container, activeData, stats) {
    // 1. 渲染基础 HTML (  加了 班级筛选 和 打印按钮)
    container.innerHTML = `
        <h2>模块十：学生偏科诊断 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            分析学生的学科均衡度，快速定位“高分低能”或“严重偏科”的学生。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">偏科程度四象限图</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(右上: 尖子生有短板 | 右下: 学霸全能 | 左上: 基础差且偏科 | 左下: 基础差但均衡)</span>
            </div>
            <div class="chart-container" id="weakness-scatter-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls" style="justify-content: space-between;">
                <h4 style="margin:0;">学生偏科诊断总表</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(按“最弱项偏离度”排序)</span>
            </div>

            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0 0 15px 0; flex-wrap: wrap; gap: 10px;">
                
                <label for="weakness-class-filter">班级:</label>
                <select id="weakness-class-filter" class="sidebar-select" style="min-width: 120px;">
                    <option value="ALL">-- 全部 --</option>
                    </select>

                <label for="weakness-search" style="margin-left: 10px;">搜索:</label>
                <input type="text" id="weakness-search" placeholder="输入姓名或考号..." style="width: 150px;">

                <button id="weakness-print-btn" class="sidebar-button" style="background-color: var(--color-blue); margin-left: auto;">
                    🖨️ 打印表格
                </button>
            </div>

            <div class="table-container" id="weakness-table-container"></div>

            <div id="weakness-detail-container" style="margin-top: 20px; display: none;"></div>
        </div>
    `;

    // 2. (核心) 计算偏科数据
    const weaknessData = calculateWeaknessData(activeData, stats);

    // 3. 渲染图表
    renderWeaknessScatter('weakness-scatter-chart', weaknessData, stats);

    // 4. 渲染表格 (包含填充下拉框逻辑)
    renderWeaknessTable('weakness-table-container', weaknessData);

    // 5. 绑定主表点击事件 (详情弹窗)
    const tableContainer = document.getElementById('weakness-table-container');
    const detailContainer = document.getElementById('weakness-detail-container');

    tableContainer.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;

        const studentId = row.dataset.id;
        const studentData = weaknessData.find(d => String(d.student.id) === String(studentId));

        if (studentData) {
            renderWeaknessDetail(detailContainer, studentData);
            detailContainer.style.display = 'block';
            // 滚动到详情处
            detailContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}

/**
 * (    ) 9.8. 模块八：临界生分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 */
function renderBoundary(container, activeData, stats) {

    // 1. 渲染HTML
    container.innerHTML = `
        <h2>模块五：临界生分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            快速定位“差一点”就能上一个台阶的学生。(单击学生姓名可以快速查看学生各科分数！)
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4>自定义临界线筛选</h4>
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; flex-wrap: wrap;">
                <label>科目:</label>
                <select id="boundary-subject" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <label>分数线:</label>
                <select id="boundary-line-type" class="sidebar-select">
                    <option value="excel">优秀线</option>
                    <option value="good">良好线</option>
                    <option value="pass">及格线</option>
                    <option value="average">平均分</option>
                </select>
                <label>范围 (±):</label>
                <input type="number" id="boundary-range" value="5" style="width: 60px;">
                <button id="boundary-filter-btn" class="sidebar-button">筛选</button>
            </div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4>快捷预设筛选</h4>
            <div class="shortcut-btn-group" style="border-top: none; padding-top: 0;">
                <button class="shortcut-btn" data-preset="high_potential">高分短板生 (总分优秀, 1科不及格)</button>
                <button class="shortcut-btn" data-preset="pass_potential">及格短板生 (总分及格, 1科不及格)</button>
                <button class="shortcut-btn" data-preset="holistic_pass">全科及格生</button>
                <button class="shortcut-btn" data-preset="holistic_excel">全科优秀生</button>
                <button class="shortcut-btn" data-preset="multi_fail">多科不及格生 (>=3科)</button>
            </div>
        </div>

        <div id="boundary-charts-area" style="display: none;">
            <div class="dashboard-chart-grid-2x2" style="margin-bottom: 20px;">
                <div class="main-card-wrapper">
                    <h4 style="margin:0;">📉 临界生“短板科目”频次统计</h4>
                    <p style="font-size:0.8em; color:#999; margin:5px 0;">* 统计这批学生在各科未达标（如不及格）的人次，柱子越高代表该科目是群体的共同短板。</p>
                    <div class="chart-container" id="boundary-bottleneck-chart" style="height: 350px;"></div>
                </div>
                <div class="main-card-wrapper">
                    <h4 style="margin:0;">🎯 临界分差散点图 (距离目标线)</h4>
                    <p style="font-size:0.8em; color:#999; margin:5px 0;">* Y轴=0为目标线。点在红区表示未达标，绿区表示已达标。越靠近0轴提升性价比越高。</p>
                    <div class="chart-container" id="boundary-gap-chart" style="height: 350px;"></div>
                </div>
            </div>
        </div>

        <div class="main-card-wrapper" id="boundary-results-wrapper" style="display: none;">
                <h4 id="boundary-results-title">筛选结果</h4>
                <div class="table-container" id="boundary-results-table"></div>

                <div id="boundary-detail-container" style="margin-top: 20px; display: none; border-top: 1px solid var(--border-color); padding-top: 20px;">
                    </div>
            </div>
        `;



    // 2. 绑定事件
    const subjectSelect = document.getElementById('boundary-subject');
    const lineTypeSelect = document.getElementById('boundary-line-type');
    const rangeInput = document.getElementById('boundary-range');
    const filterBtn = document.getElementById('boundary-filter-btn');
    const presetBtns = document.querySelectorAll('.shortcut-btn[data-preset]');

    const resultsWrapper = document.getElementById('boundary-results-wrapper');
    const resultsTitle = document.getElementById('boundary-results-title');
    const resultsTable = document.getElementById('boundary-results-table');

    // (辅助函数) 渲染表格
    const renderResultTable = (title, students, targetSubject, lineTypeLabel) => { // 👈 注意：这里多传一个 lineTypeLabel 参数，方便图表标题使用
        resultsTitle.innerText = title;
        resultsWrapper.style.display = 'block';
        
        // 🔥 新增：显示并渲染图表区域
        document.getElementById('boundary-charts-area').style.display = 'block';
        
        // 稍作延时确保容器可见
        setTimeout(() => {
            // 1. 渲染短板归因图
            renderBoundaryBottleneckChart('boundary-bottleneck-chart', students);
            // 2. 渲染分差散点图 (需要知道当前对比的是什么线，例如"及格线")
            renderBoundaryGapChart('boundary-gap-chart', students, lineTypeLabel || '及格线'); 
        }, 100);

        if (!students || students.length === 0) {
            resultsTable.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 20px;">未找到符合条件的学生。</p>`;
            // 如果没人，清空图表
            const chart1 = echarts.getInstanceByDom(document.getElementById('boundary-bottleneck-chart'));
            if(chart1) chart1.clear();
            const chart2 = echarts.getInstanceByDom(document.getElementById('boundary-gap-chart'));
            if(chart2) chart2.clear();
            return;
        }

        //      仅当 targetSubject 不是 'totalScore' 时才添加额外列
        const isSubject = targetSubject && targetSubject !== 'totalScore';

        let targetHeaderTitle = isSubject ? `<th>${targetSubject} 分数</th>` : '';

        resultsTable.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>姓名</th>
                        <th>班级</th>
                        <th>总分</th>
                        <th>班排</th>
                        ${targetHeaderTitle}
                    </tr>
                </thead>
                <tbody>
                    ${students.map(s => `
                    <tr data-id="${s.id}"> <td data-action="show-detail" style="cursor: pointer; color: var(--primary-color); font-weight: 600;">
                                ${s.name}
                            </td>
                        <td>${s.class}</td>
                        <td>${s.totalScore}</td>
                        <td>${s.rank}</td>
                        ${isSubject ? `<td><strong>${s.scores[targetSubject] || 'N/A'}</strong></td>` : ''}
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    };

    // 3. 事件：自定义筛选
    filterBtn.addEventListener('click', () => {
        const subject = subjectSelect.value;
        const lineType = lineTypeSelect.value;
        const range = parseFloat(rangeInput.value) || 0;

        let threshold = 0;
        //    (重构)
        if (lineType === 'average') {
            // (平均分逻辑: 从 stats 中读取)
            if (subject === 'totalScore') {
                threshold = stats.totalScore ? stats.totalScore.average : 0;
            } else {
                threshold = stats[subject] ? stats[subject].average : 0;
            }
        } else {
            // (原有逻辑: 从 G_SubjectConfigs 中累加)
            if (subject === 'totalScore') {
                threshold = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key] ? G_SubjectConfigs[key][lineType] : 0), 0);
            } else {
                threshold = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject][lineType] : 0;
            }
        }

        const min = threshold - range;
        const max = threshold + range;

        const filteredStudents = activeData.filter(s => {
            const score = (subject === 'totalScore') ? s.totalScore : s.scores[subject];
            return score >= min && score <= max;
        });

        const lineLabel = lineTypeSelect.options[lineTypeSelect.selectedIndex].text; 

        renderResultTable(
            `“${subject}” 在 “${lineLabel}” ( ${threshold.toFixed(0)}分 ) ± ${range}分 的学生 (${filteredStudents.length}人)`, 
            filteredStudents, 
            subject,
            lineLabel // 👈 传入新参数
        );
        //renderResultTable(`“${subject}” 在 “${lineTypeSelect.options[lineTypeSelect.selectedIndex].text}” ( ${threshold.toFixed(0)}分 ) ± ${range}分 的学生 (${filteredStudents.length}人)`, filteredStudents, subject);
    });

    // (辅助函数) 获取总分线
    const getTotalLine = (lineType) => {
        return G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key] ? G_SubjectConfigs[key][lineType] : 0), 0);
    };

    // 4. 事件：预设筛选
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            let title = '';
            let filteredStudents = [];

            const totalPassLine = getTotalLine('pass');
            const totalExcelLine = getTotalLine('excel');

            if (preset === 'holistic_pass') {
                title = '全科及格生';
                filteredStudents = activeData.filter(s => {
                    return G_DynamicSubjectList.every(subject => {
                        const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
                        return (s.scores[subject] || 0) >= passLine;
                    });
                });
            } else if (preset === 'pass_potential' || preset === 'high_potential') {
                const minTotal = (preset === 'pass_potential') ? totalPassLine : totalExcelLine;
                title = (preset === 'pass_potential') ? '及格短板生 (总分及格, 1科不及格)' : '高分短板生 (总分优秀, 1科不及格)';

                filteredStudents = activeData.filter(s => {
                    if (s.totalScore < minTotal) return false;

                    let failCount = 0;
                    G_DynamicSubjectList.forEach(subject => {
                        const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
                        if ((s.scores[subject] || 0) < passLine) {
                            failCount++;
                        }
                    });
                    return failCount === 1; //    严格限制为只有1科不及格
                });
            } else if (preset === 'holistic_excel') {
                title = '全科优秀生';
                filteredStudents = activeData.filter(s => {
                    return G_DynamicSubjectList.every(subject => {
                        const excelLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].excel : 0;
                        return (s.scores[subject] || 0) >= excelLine;
                    });
                });

                //    (    )
            } else if (preset === 'multi_fail') {
                title = '多科不及格生 (>=3科)';
                filteredStudents = activeData.filter(s => {
                    let failCount = 0;
                    G_DynamicSubjectList.forEach(subject => {
                        const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
                        if ((s.scores[subject] === null || s.scores[subject] === undefined) || s.scores[subject] < passLine) {
                            failCount++;
                        }
                    });
                    return failCount >= 3;
                });
            }
            let lineLabel = '及格线'; 
            if (preset.includes('high') || preset.includes('excel')) {
                lineLabel = '优秀线'; // 高分相关的预设，对比的是优秀线
            }

            // ✅ [修改] 传入 lineLabel
            renderResultTable(`${title} (${filteredStudents.length}人)`, filteredStudents, null, lineLabel);
            
            //renderResultTable(`${title} (${filteredStudents.length}人)`, filteredStudents, null);
        });
    });
    //    (    ) 为结果表添加点击事件
    const detailContainer = document.getElementById('boundary-detail-container');

    resultsTable.addEventListener('click', (e) => {
        // (寻找被点击的 <td> 单元格)
        const cell = e.target.closest('td[data-action="show-detail"]');
        // (寻找被点击的 <tr> 行)
        const row = e.target.closest('tr[data-id]');

        if (!cell || !row) return; // 必须点击在指定单元格上

        const studentId = row.dataset.id;
        const student = activeData.find(s => String(s.id) === String(studentId));

        if (student) {
            // (调用  函数渲染详情)
            renderBoundaryStudentDetail(detailContainer, student);
            detailContainer.style.display = 'block';
        }
    });
}


/**
 * [升级版] 模块五：临界生 - 短板科目频次图
 */
function renderBoundaryBottleneckChart(elementId, students) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 1. 准备数据容器：{ '语文': {count: 0, students: []}, ... }
    const bottleneckMap = {};
    G_DynamicSubjectList.forEach(sub => {
        bottleneckMap[sub] = { count: 0, students: [] };
    });

    // 2. 遍历统计
    students.forEach(s => {
        G_DynamicSubjectList.forEach(sub => {
            const score = s.scores[sub];
            const config = G_SubjectConfigs[sub] || { pass: 60 };
            
            // 如果分数 < 及格线 (pass) 或者缺考，视为该科是短板
            if (typeof score !== 'number' || score < config.pass) {
                bottleneckMap[sub].count++;
                bottleneckMap[sub].students.push(s);
            }
        });
    });

    const xData = Object.keys(bottleneckMap);
    // 构建 ECharts 需要的数据对象数组
    const seriesData = xData.map(sub => ({
        name: sub,
        value: bottleneckMap[sub].count,
        studentList: bottleneckMap[sub].students // 藏入名单
    }));

    const option = {
        tooltip: { 
            trigger: 'item', 
            formatter: (params) => {
                return `${params.marker} <strong>${params.name}</strong><br/>` +
                       `未达标人数：${params.value} 人<br/>` +
                       `<span style="font-size:0.8em;color:#aaa;">(点击查看名单)</span>`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '10%', top: '10%', containLabel: true },
        xAxis: { 
            type: 'category', 
            data: xData, 
            axisLabel: { rotate: 30, interval: 0 } 
        },
        yAxis: { type: 'value', name: '未达标人数' },
        series: [{
            name: '未达标人数',
            type: 'bar',
            data: seriesData, // 传入包含 studentList 的对象
            itemStyle: {
                // 渐变红色，强调“短板”
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#ff7675' },
                    { offset: 1, color: '#d63031' }
                ])
            },
            label: { show: true, position: 'top' },
            cursor: 'pointer' // 鼠标变手型
        }]
    };
    myChart.setOption(option);

    // 3. 绑定点击事件
    myChart.off('click');
    myChart.on('click', function(params) {
        const targetStudents = params.data.studentList;
        const subjectName = params.name;

        if (targetStudents && targetStudents.length > 0) {
            // 调用通用弹窗
            // 这里的 title 动态获取当前筛选的范围可能比较麻烦，我们用通用的描述
            showDrillDownModal(
                `【${subjectName}】未达标临界生名单`, 
                targetStudents, 
                subjectName // 传入科目，表格里会显示该科具体分数
            );
        }
    });
}


/**
 * [新增] 模块五：临界生 - 分差散点图
 * 展示每个学生各科距离目标线（如及格线）的分差
 */
function renderBoundaryGapChart(elementId, students, lineTypeLabel) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 准备数据：[科目索引, 分差, 学生姓名, 科目名, 实际分]
    const scatterData = [];
    // 确定对比哪条线（简单起见，这里统一对比“及格线”或者根据传入的 label 模糊匹配配置）
    // 如果 lineTypeLabel 是 "优秀线"，则对比 excel，否则对比 pass
    const configKey = lineTypeLabel.includes('优秀') ? 'excel' : 'pass';

    G_DynamicSubjectList.forEach((sub, idx) => {
        const config = G_SubjectConfigs[sub] || {};
        const targetLine = config[configKey] || 60;

        students.forEach(s => {
            const score = s.scores[sub];
            if (typeof score === 'number') {
                const diff = parseFloat((score - targetLine).toFixed(1));
                // 为了图表美观，只展示在目标线附近 +/- 20分的数据，
                // 或者展示全部但重点看 0 附近的。这里展示全部。
                scatterData.push([idx, diff, s.name, sub, score, targetLine]);
            }
        });
    });

    // X轴标签
    const categories = G_DynamicSubjectList;

    const option = {
        tooltip: {
            formatter: (p) => {
                const data = p.data; // [idx, diff, name, sub, score, target]
                const diffStr = data[1] >= 0 ? `+${data[1]}` : `${data[1]}`;
                const color = data[1] >= 0 ? 'green' : 'red';
                return `<strong>${data[2]}</strong> - ${data[3]}<br/>` +
                       `实际分: ${data[4]} (线: ${data[5]})<br/>` +
                       `分差: <span style="color:${color}; font-weight:bold;">${diffStr}</span>`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '10%', top: '10%', containLabel: true },
        xAxis: {
            type: 'category',
            data: categories,
            axisLabel: { rotate: 30, interval: 0 },
            splitLine: { show: true, lineStyle: { type: 'dashed' } }
        },
        yAxis: {
            type: 'value',
            name: `距离${lineTypeLabel}分差`,
            axisLabel: { formatter: '{value} 分' }
        },
        series: [{
            type: 'scatter',
            data: scatterData,
            symbolSize: 10,
            itemStyle: {
                color: (p) => {
                    // 大于等于0 绿色，小于0 红色
                    return p.data[1] >= 0 ? '#28a745' : '#dc3545';
                },
                opacity: 0.6
            },
            markLine: {
                silent: true,
                symbol: 'none',
                data: [{ yAxis: 0 }],
                lineStyle: { color: '#333', width: 2 },
                label: { formatter: '目标线', position: 'end' }
            },
            markArea: {
                silent: true,
                itemStyle: { opacity: 0.1 },
                data: [
                    // 0轴以下标红背景
                    [{ yAxis: -999, itemStyle: { color: '#ffebee' } }, { yAxis: 0 }],
                    // 0轴以上标绿背景
                    [{ yAxis: 0, itemStyle: { color: '#e8f5e9' } }, { yAxis: 999 }]
                ]
            }
        }]
    };
    myChart.setOption(option);
}



/**
 * (    ) 9.9. 模块九：全科均衡分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 * @param {Object} stats - G_Statistics
 */
function renderHolisticBalance(container, activeData, stats) {

// 1. 渲染HTML
    container.innerHTML = `
        <h2>模块六：全科均衡分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            分析学生群体的“短板”数量及学科均衡度。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4 style="margin:0;">📉 不及格科目数量分布</h4>
            <p style="font-size:0.8em; color:#999; margin:5px 0;">* 点击柱子可查看具体学生名单。</p>
            <div class="chart-container" id="holistic-failure-count-chart" style="height: 400px;"></div>
        </div>

        <div class="dashboard-chart-grid-2x2" style="margin-bottom: 20px;">
            <div class="main-card-wrapper">
                <h4 style="margin:0;">🪵 “最短板”科目归因分布</h4>
                <p style="font-size:0.8em; color:#999; margin:5px 0;">* 统计有多少学生的“全科最差一门”是该科目 (基于得分率)。</p>
                <div class="chart-container" id="holistic-shortest-plank-chart" style="height: 350px;"></div>
            </div>
            <div class="main-card-wrapper">
                <h4 style="margin:0;">⚖️ 综合实力 vs 均衡度 矩阵</h4>
                <p style="font-size:0.8em; color:#999; margin:5px 0;">* Y轴越低越均衡。右下角为“六边形战士”，右上角为“跛脚学霸”。</p>
                <div class="chart-container" id="holistic-scatter-chart" style="height: 350px;"></div>
            </div>
        </div>

        <div class="main-card-wrapper" id="holistic-results-wrapper" style="display: none;">
            <h4 id="holistic-results-title">学生列表</h4>
            <div class="table-container" id="holistic-results-table"></div>
        </div>
    `;

    // 2. (核心)      计算不及格科目数, 并存储学生对象
    const failureData = {}; // { 0: [student1, student2], 1: [student3], ... }

    activeData.forEach(student => {
        let count = 0;
        G_DynamicSubjectList.forEach(subject => {
            const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
            if ((student.scores[subject] === null || student.scores[subject] === undefined) || student.scores[subject] < passLine) {
                count++; // (缺考也算不及格)
            }
        });

        if (!failureData[count]) {
            failureData[count] = [];
        }
        failureData[count].push(student); //      存入学生对象
    });

    // 3.      渲染图表, 并获取 ECharts 实例
    const chartInstance = renderFailureCountChart('holistic-failure-count-chart', failureData);

    // 4.    (    ) 绑定图表点击事件
    const resultsWrapper = document.getElementById('holistic-results-wrapper');
    const resultsTitle = document.getElementById('holistic-results-title');
    const resultsTable = document.getElementById('holistic-results-table');

    if (chartInstance) {
        chartInstance.on('click', (params) => {
            const failCountText = params.name; // '0 科', '1 科', ...
            const countKey = failCountText.split(' ')[0]; // '0', '1', ...
            const students = failureData[countKey];

            if (!students || students.length === 0) return;

            resultsWrapper.style.display = 'block';
            resultsTitle.innerText = `不及格 ${failCountText} 的学生 (${students.length}人)`;

            // (渲染学生列表)
            resultsTable.innerHTML = `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>姓名</th>
                                <th>班级</th>
                                <th>总分</th>
                                <th>班排</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${students.map(s => `
                            <tr>
                                <td>${s.name}</td>
                                <td>${s.class}</td>
                                <td>${s.totalScore}</td>
                                <td>${s.rank}</td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });
    }
    setTimeout(() => {
        renderHolisticShortestPlankChart('holistic-shortest-plank-chart', activeData);
        renderHolisticScatterChart('holistic-scatter-chart', activeData, stats);
    }, 100);
}


/**
 * [新增] 模块六：最短板科目归因图 (交互升级版)
 */
function renderHolisticShortestPlankChart(elementId, students) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 1. 准备数据容器：{ '语文': {count:0, students:[]}, ... }
    const plankMap = {};
    G_DynamicSubjectList.forEach(sub => {
        plankMap[sub] = { count: 0, students: [] };
    });

    // 2. 遍历学生，找出每个人的“最短板”
    students.forEach(s => {
        let minRate = 2.0; // 得分率不可能超过 1.0
        let worstSub = null;

        G_DynamicSubjectList.forEach(sub => {
            const score = s.scores[sub];
            const config = G_SubjectConfigs[sub];
            const full = config ? config.full : 100;
            
            if (typeof score === 'number' && full > 0) {
                const rate = score / full;
                if (rate < minRate) {
                    minRate = rate;
                    worstSub = sub;
                }
            }
        });

        // 归类
        if (worstSub && plankMap[worstSub]) {
            plankMap[worstSub].count++;
            plankMap[worstSub].students.push(s);
        }
    });

    // 3. 转换为图表数据并排序 (降序)
    const data = Object.keys(plankMap)
        .map(sub => ({ 
            name: sub, 
            value: plankMap[sub].count,
            studentList: plankMap[sub].students // 将名单藏在数据项里
        }))
        .sort((a, b) => b.value - a.value);

    // 4. 配置项
    const option = {
        tooltip: { 
            trigger: 'item', 
            formatter: (params) => {
                return `${params.marker} <strong>${params.name}</strong><br/>` +
                       `人数：${params.value} 人<br/>` +
                       `<span style="font-size:0.8em;color:#aaa;">(点击查看名单)</span>`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '10%', top: '10%', containLabel: true },
        xAxis: { 
            type: 'category', 
            data: data.map(d => d.name),
            axisLabel: { rotate: 30, interval: 0 }
        },
        yAxis: { type: 'value', name: '人数' },
        series: [{
            name: '短板人数',
            type: 'bar',
            data: data, // 这里传入包含 studentList 的对象数组，ECharts 会自动取 value 绘图
            itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#ff9f43' },
                    { offset: 1, color: '#ee5253' }
                ]),
                borderRadius: [4, 4, 0, 0]
            },
            label: { show: true, position: 'top' },
            cursor: 'pointer' // 鼠标变手型
        }]
    };
    myChart.setOption(option);

    // 5. 绑定点击事件 (调用通用弹窗)
    myChart.off('click'); // 防止重复绑定
    myChart.on('click', function(params) {
        // 从 data 中取出藏好的 studentList
        const targetStudents = params.data.studentList;
        const subjectName = params.name;

        if (targetStudents && targetStudents.length > 0) {
            // 调用系统现有的下钻弹窗函数
            // 标题：以“语文”为短板的学生名单
            showDrillDownModal(
                `以“${subjectName}”为最短板的学生名单`, 
                targetStudents, 
                subjectName // 传入科目，以便弹窗表格显示该科分数
            );
        }
    });
}

/**
 * [新增] 模块六：综合实力 vs 均衡度 散点图
 * X轴: 总分, Y轴: 偏科系数 (各科得分率的标准差)
 */
function renderHolisticScatterChart(elementId, students, totalStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 辅助：计算标准差
    const calcStdDev = (arr) => {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
        return Math.sqrt(variance);
    };

    // 1. 准备散点数据
    const scatterData = [];
    let maxStdDev = 0;

    students.forEach(s => {
        if (typeof s.totalScore !== 'number') return;

        // 收集该生所有科目的“得分率”
        const rates = [];
        G_DynamicSubjectList.forEach(sub => {
            const score = s.scores[sub];
            const config = G_SubjectConfigs[sub];
            if (typeof score === 'number' && config && config.full > 0) {
                rates.push(score / config.full); // 0.0 - 1.0
            }
        });

        if (rates.length > 0) {
            const dev = calcStdDev(rates); // 偏科系数
            if (dev > maxStdDev) maxStdDev = dev;
            
            // 数据格式: [总分, 偏科系数, 姓名, 班级]
            scatterData.push([s.totalScore, parseFloat(dev.toFixed(3)), s.name, s.class]);
        }
    });

    // 2. 计算辅助线 (年级平均)
    const avgTotal = totalStats.totalScore ? totalStats.totalScore.average : 0;
    const avgDev = maxStdDev * 0.4; // 估算一个合理的偏科警戒线，或者取平均值

    const option = {
        tooltip: {
            formatter: (p) => {
                const d = p.data;
                return `<strong>${d[2]}</strong> (${d[3]})<br/>` +
                       `总分: ${d[0]}<br/>` +
                       `偏科度: ${d[1]} (越低越好)`;
            }
        },
        grid: { left: '10%', right: '10%', top: '10%', bottom: '10%' },
        xAxis: {
            type: 'value',
            name: '总分 (实力)',
            nameLocation: 'middle',
            nameGap: 20,
            scale: true, // 不从0开始
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: '偏科度 (不均衡)',
            nameLocation: 'middle',
            nameGap: 30,
            splitLine: { show: false }
        },
        series: [
            {
                type: 'scatter',
                data: scatterData,
                symbolSize: 8,
                itemStyle: {
                    color: (p) => {
                        const score = p.data[0];
                        const dev = p.data[1];
                        // 简单着色逻辑
                        if (score >= avgTotal && dev <= avgDev) return '#28a745'; // 右下 (优+稳) - 绿
                        if (score >= avgTotal && dev > avgDev) return '#ff9f43';  // 右上 (优+偏) - 橙
                        if (score < avgTotal && dev > avgDev) return '#ee5253';   // 左上 (差+偏) - 红
                        return '#54a0ff'; // 左下 (差+稳) - 蓝
                    },
                    opacity: 0.7
                },
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { type: 'dashed', color: '#999' },
                    data: [
                        { xAxis: avgTotal, name: '平均总分' },
                        { yAxis: avgDev, name: '平均均衡度' }
                    ],
                    label: { formatter: '{b}' }
                },
                markArea: {
                    silent: true,
                    itemStyle: { opacity: 0.05 },
                    data: [
                        // 右下角 (六边形战士区域) - 绿色高亮
                        [
                            { xAxis: avgTotal, yAxis: 0 },
                            { xAxis: 10000, yAxis: avgDev, itemStyle: { color: '#28a745' } } // 10000是足够大的数
                        ]
                    ]
                }
            }
        ]
    };
    myChart.setOption(option);
}

/**
 * (    ) 9.10. 模块十：成绩分布变动
 * @param {Object} container - HTML 容器
 * @param {Array} currentData - (已筛选) 本次学生数据
 * @param {Array} compareData - (已筛选) 对比学生数据
 * @param {Object} currentStats - G_Statistics
 * @param {Object} compareStats - G_CompareStatistics
 */
/**
 *    UPGRADED V4    模块七：成绩分布变动 (直方图也支持 T分/原始分 切换)
 */
function renderTrendDistribution(container, currentData, compareData, currentStats, compareStats, currentFilter) {

    // 1. 检查数据
    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块七：成绩分布变动</h2><p>请先在侧边栏导入 "对比成绩" 数据。</p>`;
        return;
    }
    // 自动补全排名数据
    if (compareData.length > 0 && !compareData[0].gradeRanks) {
        compareData = addSubjectRanksToData(compareData);
        localStorage.setItem('G_CompareData', JSON.stringify(compareData));
    }

    // 2. 渲染 HTML
    container.innerHTML = `
        <h2>模块七：成绩分布变动 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                
                <div>
                    <label for="dist-subject-select">选择科目:</label>
                    <select id="dist-subject-select" class="sidebar-select" style="min-width: 120px;">
                        <option value="totalScore">总分</option>
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label>统计模式:</label>
                    <select id="dist-hist-mode" class="sidebar-select" style="width:auto; font-weight:bold; color:#20c997; border-color:#20c997;">
                        <option value="raw">📊 原始分</option>
                        <option value="tscore">⚖️ T分 (标准分)</option>
                    </select>
                </div>

                <div style="border-left: 1px solid #ddd; padding-left: 15px; display: flex; align-items: center; gap: 10px;">
                    <label for="dist-bin-size">分段间隔:</label>
                    <input type="number" id="dist-bin-size" class="sidebar-select" placeholder="自动" style="width: 70px;">
                    <button id="dist-redraw-btn" class="sidebar-button" style="padding: 6px 12px;">🔄 重绘</button>
                </div>
            </div>
            <div class="chart-container" id="dist-overlap-histogram-chart" style="height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls" style="border-bottom: none; padding-bottom: 0; margin-bottom: 10px; flex-wrap: wrap; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:15px;">
                    <h4 style="margin: 0;">各科等级构成对比</h4>
                    <select id="dist-comp-mode" class="sidebar-select" style="width:auto; font-weight:bold; color:#007bff; border-color:#007bff;">
                        <option value="raw">📊 原始分模式</option>
                        <option value="tscore">⚖️ T分模式</option>
                    </select>
                </div>
                <button id="dist-export-composition-btn" class="sidebar-button" style="padding: 4px 12px; font-size: 0.85em; background-color: var(--color-green);">
                    📥 导出名单
                </button>
            </div>
            <p style="font-size: 0.8em; color: var(--text-muted); margin-top: -5px; margin-bottom: 10px;" id="dist-comp-desc">
                * 原始分模式：A(优秀线), B(良好线), C(及格线) | T分模式：A(T≥60), B(T≥50), C(T≥40)
            </p>
            <div class="chart-container" id="dist-composition-compare-chart" style="height: 450px;"></div>
        </div>

        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls" style="border-bottom: none; padding-bottom: 0; margin-bottom: 10px;">
                <h4 style="margin: 0; margin-right: 20px;">排名分层流动图</h4>
                <label>分析对象:</label>
                <select id="dist-sankey-subject-select" class="sidebar-select" style="width: auto;">
                    <option value="totalScore">总分排名</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}排名</option>`).join('')}
                </select>
            </div>
            <div class="chart-container" id="dist-sankey-chart" style="height: 600px;"></div>
        </div>
        
        <div class="main-card-wrapper" id="dist-sankey-results-wrapper" style="display: none; margin-top: 20px;">
            <h4 id="dist-sankey-results-title">学生列表</h4>
            <div class="table-container" id="dist-sankey-results-table"></div>
        </div>
    `;

    // 3. 数据预处理
    const mergedData = currentData.map(student => {
        const oldStudent = compareData.find(s => String(s.id) === String(student.id));
        if (!oldStudent) return null;
        return {
            ...student,
            oldTotalScore: oldStudent.totalScore,
            oldRank: oldStudent.rank,
            oldGradeRank: oldStudent.gradeRank || 0,
            oldScores: oldStudent.scores || {},
            oldTScores: oldStudent.tScores || {}, // [关键] 携带旧T分
            oldClassRanks: oldStudent.classRanks || {},
            oldGradeRanks: oldStudent.gradeRanks || {}
        };
    }).filter(s => s !== null);

    // 4. 逻辑 A: 直方图 (修复版 - 移除冗余变量)
    const subjectSelect = document.getElementById('dist-subject-select');
    const histModeSelect = document.getElementById('dist-hist-mode');
    const binInput = document.getElementById('dist-bin-size');
    const redrawBtn = document.getElementById('dist-redraw-btn');

    const drawHistogram = () => {
        const subject = subjectSelect.value;
        const mode = histModeSelect.value; // 'raw' or 'tscore'
        const binSize = parseFloat(binInput.value);

        //    核心修复    
        // 直接将完整数据 (currentData, compareData) 传给绘图函数。
        // 内部会自动根据 mode 提取 scores 或 tScores。
        // 之前这里有多余的 currentScores 计算代码，导致报错，现已删除。
        renderOverlappingHistogram('dist-overlap-histogram-chart', currentData, compareData, subject, binSize, mode);
    };

    // 绑定事件 (保持不变)
    subjectSelect.addEventListener('change', () => { binInput.value = ''; drawHistogram(); });
    histModeSelect.addEventListener('change', () => { binInput.value = ''; drawHistogram(); });
    redrawBtn.addEventListener('click', drawHistogram);

    // 5.    NEW    逻辑 B: 等级对比图 (支持切换)
    const compModeSelect = document.getElementById('dist-comp-mode');
    const exportBtn = document.getElementById('dist-export-composition-btn');
    const descText = document.getElementById('dist-comp-desc');

    const drawComposition = () => {
        const mode = compModeSelect.value; // 'raw' or 'tscore'

        // 更  说明文字
        if (mode === 'raw') descText.innerText = '* 原始分模式：基于“科目配置”中的 优秀线(A)、良好线(B)、及格线(C) 进行统计。';
        else descText.innerText = '* T分模式 (标准分)：A (T≥60, 前16%), B (T≥50, 前50%), C (T≥40, 前84%), D (T<40)。消除试卷难度差异。';

        // 调用绘图
        renderTrendCompositionChart('dist-composition-compare-chart', currentData, compareData, mode);
    };

    compModeSelect.addEventListener('change', drawComposition);

    // 绑定导出
    exportBtn.addEventListener('click', () => {
        const mode = compModeSelect.value;
        exportCompositionDetails(mergedData, mode); // 传入当前模式
    });

    // 5. 桑基图逻辑
    const sankeySubjectSelect = document.getElementById('dist-sankey-subject-select');
    const total = currentData.length;

    // 分层规则
    const rankTiers = [
        { name: 'Top 10%', min: 1, max: Math.ceil(total * 0.1) },
        { name: '10%-30%', min: Math.ceil(total * 0.1) + 1, max: Math.ceil(total * 0.3) },
        { name: '30%-60%', min: Math.ceil(total * 0.3) + 1, max: Math.ceil(total * 0.6) },
        { name: 'Bottom 40%', min: Math.ceil(total * 0.6) + 1, max: total }
    ];

    const getRankCategory = (rank) => {
        for (const tier of rankTiers) {
            if (rank >= tier.min && rank <= tier.max) return tier.name;
        }
        return 'N/A';
    };

    let sankeyInstance = null;
    const drawSankey = () => {
        const subject = sankeySubjectSelect.value;
        sankeyInstance = renderRankingSankey('dist-sankey-chart', mergedData, rankTiers, getRankCategory, currentFilter, subject);
        bindSankeyEvents();
    };

    sankeySubjectSelect.addEventListener('change', drawSankey);

    // 6. 初始绘制
    drawHistogram();
    drawComposition();
    drawSankey();


    //            绑定导出等级名单事件
    document.getElementById('dist-export-composition-btn').addEventListener('click', () => {
        exportCompositionDetails(mergedData);
    });

    // [修改版] 导出逻辑
    const exportCompositionDetails = (data, mode = 'raw') => {
        const exportData = [];
        const subjects = G_DynamicSubjectList;
        const label = mode === 'tscore' ? 'T分' : '原始分';

        exportData.push(["科目", "本次等级", "班级", "姓名", `本次${label}`, "上次等级", `上次${label}`, "变动情况"]);

        subjects.forEach(subject => {
            const config = G_SubjectConfigs[subject] || {};

            // 等级判断 (内部根据 mode 分流)
            const getLevel = (val) => {
                if (val === undefined || val === null || isNaN(val)) return '无数据';
                if (mode === 'tscore') {
                    if (val >= 60) return 'A (优秀)';
                    if (val >= 50) return 'B (良好)';
                    if (val >= 40) return 'C (及格)';
                    return 'D (不及格)';
                } else {
                    if (val >= config.excel) return 'A (优秀)';
                    if (val >= config.good) return 'B (良好)';
                    if (val >= config.pass) return 'C (及格)';
                    return 'D (不及格)';
                }
            };

            const levelVal = (l) => {
                if (l.startsWith('A')) return 4; if (l.startsWith('B')) return 3;
                if (l.startsWith('C')) return 2; if (l.startsWith('D')) return 1;
                return 0;
            };

            data.forEach(s => {
                // 根据模式获取分数
                let currVal, oldVal;
                if (mode === 'tscore') {
                    currVal = (s.tScores && s.tScores[subject]);
                    oldVal = (s.oldTScores && s.oldTScores[subject]);
                } else {
                    currVal = s.scores[subject];
                    oldVal = s.oldScores[subject];
                }

                const currLevel = getLevel(currVal);
                const oldLevel = getLevel(oldVal);

                // 变动判断
                let changeText = '-';
                const v1 = levelVal(currLevel);
                const v2 = levelVal(oldLevel);
                if (v1 > 0 && v2 > 0) {
                    if (v1 > v2) changeText = '⬆️ 升级';
                    else if (v1 < v2) changeText = '⬇️ 降级';
                    else changeText = '➡️ 保持';
                }

                if (v1 > 0 || v2 > 0) {
                    exportData.push([
                        subject,
                        currLevel,
                        s.class,
                        s.name,
                        currVal !== undefined && currVal !== null ? currVal.toFixed(1) : '-',
                        oldLevel,
                        oldVal !== undefined && oldVal !== null ? oldVal.toFixed(1) : '-',
                        changeText
                    ]);
                }
            });
            exportData.push([]);
        });

        const ws = XLSX.utils.aoa_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `${label}等级分布`);
        XLSX.writeFile(wb, `${label}等级变动名单_${new Date().toLocaleDateString()}.xlsx`);
    };


    // 7. 绑定桑基图点击事件 (修复版：解决单科点击无反应 Bug)
    function bindSankeyEvents() {
        const resultsWrapper = document.getElementById('dist-sankey-results-wrapper');
        const resultsTitle = document.getElementById('dist-sankey-results-title');
        const resultsTable = document.getElementById('dist-sankey-results-table');

        if (sankeyInstance) {
            sankeyInstance.off('click');
            sankeyInstance.on('click', (params) => {
                const subject = sankeySubjectSelect.value;
                const isTotal = (subject === 'totalScore');
                const useGradeRank = (currentFilter === 'ALL');
                const { dataType, data } = params;

                // [核心修复] 安全获取排名和分数
                const getRanks = (s) => {
                    if (isTotal) {
                        return {
                            old: useGradeRank ? s.oldGradeRank : s.oldRank,
                            new: useGradeRank ? s.gradeRank : s.rank,
                            oldScore: s.oldTotalScore,
                            newScore: s.totalScore
                        };
                    } else {
                        // 🔥 修复点：增加 (s.oldGradeRanks || {}) 安全访问
                        // 防止因排名数据缺失导致的 undefined 报错
                        const oldRanks = useGradeRank ? (s.oldGradeRanks || {}) : (s.oldClassRanks || {});
                        const newRanks = useGradeRank ? (s.gradeRanks || {}) : (s.classRanks || {});
                        
                        return {
                            old: oldRanks[subject] || 0,
                            new: newRanks[subject] || 0,
                            // 分数也加安全检查
                            oldScore: (s.oldScores && s.oldScores[subject] !== undefined) ? s.oldScores[subject] : '-',
                            newScore: (s.scores && s.scores[subject] !== undefined) ? s.scores[subject] : '-'
                        };
                    }
                };

                let students = [];
                let title = '';

                if (dataType === 'link') {
                    title = `${data.source} → ${data.target} (${data.value}人)`;
                    const sourceTierName = data.source.replace('上次: ', '');
                    const targetTierName = data.target.replace('本次: ', '');

                    students = mergedData.filter(s => {
                        const r = getRanks(s);
                        return r.old > 0 && r.new > 0 &&
                            getRankCategory(r.old) === sourceTierName &&
                            getRankCategory(r.new) === targetTierName;
                    });
                } else if (dataType === 'node') {
                    title = `${params.name} (${params.value}人)`;
                    // 修复节点名称解析 (去掉前缀)
                    const nodeName = data.name.replace(/^(上次|本次): /, '');
                    const isOld = data.name.startsWith('上次:');

                    students = mergedData.filter(s => {
                        const r = getRanks(s);
                        const rankToCheck = isOld ? r.old : r.new;
                        return rankToCheck > 0 && getRankCategory(rankToCheck) === nodeName;
                    });
                }

                if (students.length > 0) {
                    resultsWrapper.style.display = 'block';
                    resultsTitle.innerText = `${title} - ${isTotal ? '总分' : subject}`;

                    const scoreLabel = isTotal ? '总分' : subject;
                    const rankLabel = useGradeRank ? '年排' : '班排';

                    resultsTable.innerHTML = `
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>姓名</th><th>班级</th>
                                        <th>上次分层</th> <th>本次分层</th>
                                        <th>本次${scoreLabel}</th><th>本次${rankLabel}</th>
                                        <th>上次${scoreLabel}</th><th>上次${rankLabel}</th>
                                    </tr>
                                </thead>
                                <tbody>
                        ${students.map(s => {
                        const r = getRanks(s);

                        // 获取分层名称
                        const oldTierName = getRankCategory(r.old);
                        const newTierName = getRankCategory(r.new);

                        const tierOld = rankTiers.findIndex(t => t.name === oldTierName);
                        const tierNew = rankTiers.findIndex(t => t.name === newTierName);

                        let rowClass = '';
                        // 索引越小代表排名越靠前 (Top 10% 是 0)，所以 旧索引 > 新索引 = 进步
                        if (tierOld > tierNew) rowClass = 'progress';
                        else if (tierOld < tierNew) rowClass = 'regress';

                        return `
                                        <tr class="${rowClass}">
                                            <td>${s.name}</td><td>${s.class}</td>
                                            
                                            <td style="color: #888; font-size: 0.9em;">${oldTierName}</td>
                                            <td style="font-weight: bold;">${newTierName}</td>
                                            
                                            <td><strong>${r.newScore}</strong></td>
                                            <td>${r.new}</td>
                                            <td>${r.oldScore}</td>
                                            <td>${r.old}</td>
                                        </tr>`;
                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                    
                    // 滚动到表格位置
                    resultsWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        }
    }
}

/**
 *   9.11. 模块：数据管理中心
 *    修复版    解决 loadMultiExamData 异步调用问题
 */
function renderMultiExam(container) {

    // 1. 渲染模块 HTML (保持不变)
    container.innerHTML = `
        <h2>考试系统中心和多次数据分析</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            在此模块上传的成绩将被浏览器永久保存（直到您手动清除）。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4>考试列表管理</h4>
            <ol id="multi-exam-list" class="multi-exam-list-container"></ol>

            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 15px 0 0 0; border-top: 1px solid var(--border-color); flex-wrap: wrap; justify-content: space-between;">
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <label for="multi-file-uploader" class="upload-label" style="padding: 10px 16px; background-color: var(--primary-color); color: white;">
                        📊 添加  成绩 (可多选)
                    </label>
                    <input type="file" id="multi-file-uploader" accept=".xlsx, .xls, .csv" style="display: none;" multiple>

                    <label for="multi-json-uploader" class="upload-label" style="padding: 10px 16px; background-color: var(--color-orange); color: white;">
                        📥 导入全系统备份 (JSON)
                    </label>
                    <input type="file" id="multi-json-uploader" accept=".json" style="display: none;">
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button id="multi-export-all" class="sidebar-button" style="background-color: var(--color-green);">
                        📤 导出全系统备份 (JSON)  </button>
                    </button>
                    <button id="multi-clear-all" class="sidebar-button" style="background-color: var(--color-red);">
                        🗑️ 清除全部
                    </button>
                </div>
            </div>
            <span id="multi-file-status" style="margin-top: 10px; color: var(--text-muted); display: block;"></span>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar">
                <label for="multi-student-search">搜索学生 (姓名/考号):</label>
                <div class="search-combobox">
                    <input type="text" id="multi-student-search" placeholder="输入姓名或考号..." autocomplete="off">
                    <div class="search-results" id="multi-student-search-results"></div>
                </div>
            </div>
        </div>

        <div id="multi-student-report" style="display: none;">
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <h4 id="multi-student-name-title">学生报表</h4>
                
                <div id="multi-subject-filter-container">
                    <div class="main-card-wrapper" style="padding: 15px; margin-top: 10px; box-shadow: var(--shadow-sm);">
                        <h5>各科成绩曲线 (图1) - 科目筛选</h5>
                        <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; flex-wrap: wrap; gap: 10px;">
                            <button id="multi-subject-all" class="sidebar-button" style="padding: 5px 10px; font-size: 0.8em;">全选</button>
                            <button id="multi-subject-none" class="sidebar-button" style="padding: 5px 10px; font-size: 0.8em; background-color: var(--color-gray);">全不选</button>
                        </div>
                        <div id="multi-subject-checkboxes" class="multi-subject-filter-container">
                        </div>
                    </div>
                </div>

                <div class="dashboard-chart-grid-1x1" style="margin-top: 20px;">
                    <div class="main-card-wrapper" style="padding: 15px; margin-bottom: 0; border-bottom: none; border-radius: 8px 8px 0 0;">
                        <h4 style="margin: 0;">1. 各科分数变化曲线</h4>
                        <p style="margin: 5px 0 0 0; font-size: 0.8em; color: var(--text-muted);">* 受上方“科目复选框”控制</p>
                    </div>
                    <div class="chart-container" id="multi-exam-score-chart" style="height: 350px; margin-top: 0; border: 1px solid var(--border-color); border-top: none; border-radius: 0 0 8px 8px; background: #fff;"></div>

                    <div class="main-card-wrapper" style="padding: 15px; margin-top: 20px; margin-bottom: 0; border-bottom: none; border-radius: 8px 8px 0 0;">
                        <h4 style="margin: 0;">2. 总分排名变化曲线</h4>
                        <p style="margin: 5px 0 0 0; font-size: 0.8em; color: var(--text-muted);">* 固定显示总分排名，不受筛选影响</p>
                    </div>
                    <div class="chart-container" id="multi-exam-rank-chart" style="height: 350px; margin-top: 0; border: 1px solid var(--border-color); border-top: none; border-radius: 0 0 8px 8px; background: #fff;"></div>

                    <div class="main-card-wrapper" style="padding: 15px; margin-top: 20px; margin-bottom: 0; border-bottom: none; border-radius: 8px 8px 0 0;">
                        <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; margin: 0; justify-content: space-between; flex-wrap: wrap;">
                            <h4 style="margin: 0;">3. 各科排名变化曲线</h4>
                            
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <label for="multi-rank-type-select" style="margin: 0; font-size: 0.9em;">显示类型:</label>
                                <select id="multi-rank-type-select" class="sidebar-select" style="width: auto; padding: 6px 12px;">
                                    <option value="both">同时显示 (班排 + 年排)</option>
                                    <option value="class">仅看班级排名</option>
                                    <option value="grade">仅看年级排名</option>
                                </select>
                            </div>
                        </div>
                        <p style="margin: 5px 0 0 0; font-size: 0.8em; color: var(--text-muted);">
                            * 受上方“科目复选框” 和 此处“显示类型” 共同控制
                        </p>
                    </div>
                    <div class="chart-container" id="multi-exam-subject-rank-chart" style="height: 350px; margin-top: 0; border: 1px solid var(--border-color); border-top: none; border-radius: 0 0 8px 8px; background: #fff;"></div>
                </div>

                <div id="multi-student-table-container" class="multi-exam-table-container">
                </div>
            </div>
        </div>
    `;

    // 2. 绑定 DOM 和事件
    const multiUploader = document.getElementById('multi-file-uploader');
    const statusLabel = document.getElementById('multi-file-status');
    const listContainer = document.getElementById('multi-exam-list');
    const clearBtn = document.getElementById('multi-clear-all');
    const exportBtn = document.getElementById('multi-export-all');
    const jsonUploader = document.getElementById('multi-json-uploader');

    // (上传事件)
    multiUploader.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        statusLabel.innerText = `🔄 正在解析 ${files.length} 个文件...`;
        let loadedData = await loadMultiExamData();

        try {
            for (const file of files) {
                const { processedData } = await loadExcelData(file);
                const rankedData = addSubjectRanksToData(processedData);

                loadedData.push({
                    id: Date.now() + Math.random(),
                    originalName: file.name,
                    label: file.name.replace(/\.xlsx|\.xls|\.csv/g, ''),
                    students: rankedData,
                    isHidden: false // 默认不隐藏
                });
            }

            statusLabel.innerText = `✅ 成功添加 ${files.length} 次考试。`;
            saveMultiExamData(loadedData);
            renderMultiExamList(loadedData);
            initializeStudentSearch(loadedData);

        } catch (err) {
            statusLabel.innerText = `❌ 加载失败: ${err.message}`;
            console.error(err);
        }
    });

    // (列表交互事件: 重命名)
    listContainer.addEventListener('input', async (e) => { // async added just in case
        if (e.target && e.target.dataset.role === 'label') {
            const id = e.target.closest('li').dataset.id;
            const newLabel = e.target.value;
            let data = await loadMultiExamData(); // await
            const item = data.find(d => String(d.id) === id);
            if (item) {
                item.label = newLabel;
                saveMultiExamData(data);
                initializeStudentSearch(data);
                document.getElementById('multi-student-report').style.display = 'none';
            }
        }
    });

    // (列表交互事件: 按钮点击)
    listContainer.addEventListener('click', async (e) => { // async added
        if (!e.target) return;
        const button = e.target.closest('button');
        if (!button) return;

        const role = button.dataset.role;
        const id = button.closest('li').dataset.id;
        let data = await loadMultiExamData(); // await
        const index = data.findIndex(d => String(d.id) === id);

        if (index === -1) return;

        if (role === 'toggle-hide') {
            data[index].isHidden = !data[index].isHidden;
            document.getElementById('multi-student-report').style.display = 'none';
        } else if (role === 'delete') {
            const itemLabel = data[index].label;
            if (confirm(`您确定要删除 "${itemLabel}" 这次考试吗？\n此操作不可撤销。`)) {
                data.splice(index, 1);
            } else {
                return;
            }
        } else if (role === 'up' && index > 0) {
            [data[index - 1], data[index]] = [data[index], data[index - 1]];
        } else if (role === 'down' && index < data.length - 1) {
            [data[index + 1], data[index]] = [data[index], data[index + 1]];
        }

        saveMultiExamData(data);
        renderMultiExamList(data);
        initializeStudentSearch(data);
        document.getElementById('multi-student-report').style.display = 'none';
    });

    // (清空事件)
    clearBtn.addEventListener('click', () => {
        if (confirm('您确定要清除所有已保存的“多次考试”数据吗？此操作不可撤销。')) {
            saveMultiExamData([]);
            renderMultiExamList([]);
            initializeStudentSearch([]);
            document.getElementById('multi-student-report').style.display = 'none';
        }
    });

    // ============================================================
    //    核心升级    全系统数据导出 (Full System Export)
    // ============================================================
    exportBtn.onclick = async () => { // 使用 onclick 避免重复绑定
        try {
            exportBtn.innerText = "📦 打包中...";
            exportBtn.disabled = true;

            // 1. 准备要备份的数据 Key 清单
            // 格式: { backupKey: localForageKey/localStorageKey, type: 'localforage'/'localstorage' }

            // (A) 从 IndexedDB 获取的大数据
            const [
                collections,
                goalArchives,
                goalSessionMeta,
                itemLibrary,
                subjectConfigs
            ] = await Promise.all([
                localforage.getItem('G_MultiExam_Collections_V2'), // 考试列表库
                localforage.getItem('G_Goal_Archives'),            // 目标规划-档案
                localforage.getItem('G_Goal_Session_Meta'),        // 目标规划-列表元数据
                localforage.getItem('G_ItemAnalysis_Library'),     // 学科小题库
                localforage.getItem('G_SubjectConfigs')            // 全局科目配置
            ]);

            // (B) 从 localStorage 获取的状态/小数据
            const metaData = {
                activeCollectionId: localStorage.getItem('G_MultiExam_ActiveId'),
                activeGoalSessionId: localStorage.getItem('G_Goal_Current_Session_ID'),
                deepSeekKey: localStorage.getItem('G_DeepSeekKey'), // 可选：备份API Key方便迁移
                theme: localStorage.getItem('app_theme')
            };

            // 2. 构建全量备份对象
            const fullBackup = {
                __version__: "SmartPrism_Full_v2.0", // 版本标识，用于导入时识别
                timestamp: new Date().toLocaleString(),
                data: {
                    collections: collections || {},
                    goalArchives: goalArchives || {},
                    goalSessionMeta: goalSessionMeta || [],
                    itemLibrary: itemLibrary || [],
                    subjectConfigs: subjectConfigs || {},
                    meta: metaData
                }
            };

            // 3. 生成文件并下载
            const jsonString = JSON.stringify(fullBackup, null, 2); // 美化输出
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `智慧棱镜_全系统备份_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            statusLabel.innerText = `✅ 全系统备份已导出 (包含考试库、规划、小题库等)`;
            statusLabel.style.color = "green";

        } catch (err) {
            console.error(err);
            alert("导出失败: " + err.message);
            statusLabel.innerText = `❌ 导出失败`;
        } finally {
            exportBtn.innerText = "📤 导出全系统备份 (JSON)";
            exportBtn.disabled = false;
        }
    };

    // ============================================================
    //    核心升级    全系统数据导入 (Full System Import)
    // ============================================================
    jsonUploader.onchange = (event) => { // 使用 onchange 覆盖
        const file = event.target.files[0];
        if (!file) return;

        statusLabel.innerText = `⏳ 正在解析备份文件...`;
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const jsonContent = JSON.parse(e.target.result);

                // --- 情况 A: 识别为  版全量备份 ---
                if (jsonContent.__version__ && jsonContent.__version__.startsWith("SmartPrism_Full")) {
                    const { data, timestamp } = jsonContent;

                    if (!confirm(`检测到全系统备份文件 (创建于 ${timestamp})。\n\n包含：\n- 📚 考试列表库\n- 🎯 目标规划数据\n- 🔬 小题分析库\n- ⚙️ 系统配置\n\n【警告】导入将覆盖当前浏览器的所有历史数据！\n确定要还原吗？`)) {
                        statusLabel.innerText = "操作已取消";
                        jsonUploader.value = null;
                        return;
                    }

                    statusLabel.innerText = "🔄 正在还原数据...";

                    // 1. 还原 IndexedDB 数据
                    await Promise.all([
                        localforage.setItem('G_MultiExam_Collections_V2', data.collections),
                        localforage.setItem('G_Goal_Archives', data.goalArchives),
                        localforage.setItem('G_Goal_Session_Meta', data.goalSessionMeta),
                        localforage.setItem('G_ItemAnalysis_Library', data.itemLibrary),
                        localforage.setItem('G_SubjectConfigs', data.subjectConfigs)
                    ]);

                    // 2. 还原 LocalStorage 状态
                    if (data.meta) {
                        if (data.meta.activeCollectionId) localStorage.setItem('G_MultiExam_ActiveId', data.meta.activeCollectionId);
                        if (data.meta.activeGoalSessionId) localStorage.setItem('G_Goal_Current_Session_ID', data.meta.activeGoalSessionId);
                        if (data.meta.deepSeekKey) localStorage.setItem('G_DeepSeekKey', data.meta.deepSeekKey);
                        if (data.meta.theme) {
                            localStorage.setItem('app_theme', data.meta.theme);
                            if (data.meta.theme === 'dark') document.body.setAttribute('data-theme', 'dark');
                        }
                    }

                    alert("✅ 全系统数据还原成功！页面即将刷  。");
                    location.reload(); // 刷  以应用所有更改
                }

                // --- 情况 B: 识别为旧版备份 (仅考试列表数组) ---
                else if (Array.isArray(jsonContent) || (jsonContent.length > 0 && jsonContent[0].students)) {
                    if (!confirm(`检测到旧版备份文件 (仅包含考试列表)。\n\n是否将其导入到当前选中的列表库中？(这不会覆盖目标规划和小题库)`)) {
                        jsonUploader.value = null;
                        return;
                    }

                    // 走旧的逻辑：保存到当前 collection
                    await saveMultiExamData(jsonContent);

                    // 刷  界面
                    renderMultiExamList(jsonContent);
                    initializeStudentSearch(jsonContent);
                    statusLabel.innerText = `✅ 旧版数据已导入 (仅更  考试列表)`;
                }

                else {
                    throw new Error("无法识别的文件格式。请确保这是由本系统导出的 JSON 备份。");
                }

            } catch (err) {
                console.error(err);
                alert(`❌ 导入失败: ${err.message}`);
                statusLabel.innerText = "❌ 文件解析错误";
            } finally {
                jsonUploader.value = null; // 重置控件，允许重复上传同名文件
            }
        };

        reader.onerror = () => {
            alert("文件读取失败");
            jsonUploader.value = null;
        };

        reader.readAsText(file);
    };

    // 3. 初始化数据
    loadMultiExamData().then(initialData => {
        renderMultiExamList(initialData);
        initializeStudentSearch(initialData);
    });

    // ------------------------------------------------------------------
    //    核心修复    在这里绑定“排名类型”和“复选框”的监听器
    // ------------------------------------------------------------------

    // (监听: 排名类型下拉框 - [Fix]   加 async/await)
    const rankTypeSelect = document.getElementById('multi-rank-type-select');
    if (rankTypeSelect) {
        rankTypeSelect.addEventListener('change', async () => {
            const reportContainer = document.getElementById('multi-student-report');
            const currentStudentId = reportContainer.dataset.studentId;
            if (currentStudentId) {
                const data = await loadMultiExamData();
                drawMultiExamChartsAndTable(currentStudentId, data, false);
            }
        });
    }

    // (监听: 复选框容器 - [Fix]   加 async/await)
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    if (checkboxContainer) {
        checkboxContainer.addEventListener('change', async () => {
            const reportContainer = document.getElementById('multi-student-report');
            const currentStudentId = reportContainer.dataset.studentId;
            if (currentStudentId) {
                const data = await loadMultiExamData();
                drawMultiExamChartsAndTable(currentStudentId, data, false);
            }
        });
    }

    // (监听: 全选 - [Fix]   加 async/await)
    const selectAllBtn = document.getElementById('multi-subject-all');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', async () => {
            if (checkboxContainer) {
                checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                const reportContainer = document.getElementById('multi-student-report');
                const currentStudentId = reportContainer.dataset.studentId;
                if (currentStudentId) {
                    const data = await loadMultiExamData();
                    drawMultiExamChartsAndTable(currentStudentId, data, false);
                }
            }
        });
    }

    // (监听: 全不选 - [Fix]   加 async/await)
    const selectNoneBtn = document.getElementById('multi-subject-none');
    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', async () => {
            if (checkboxContainer) {
                checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                const reportContainer = document.getElementById('multi-student-report');
                const currentStudentId = reportContainer.dataset.studentId;
                if (currentStudentId) {
                    const data = await loadMultiExamData();
                    drawMultiExamChartsAndTable(currentStudentId, data, false);
                }
            }
        });
    }
}


/**
 * (    ) 10.15. 渲染学科关联热力图 (Heatmap)
 *    (已修复)
 */
function renderCorrelationHeatmap(elementId, activeData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. (核心) 计算相关系数矩阵
    const subjects = G_DynamicSubjectList; // (已确认正确)
    const n = subjects.length;
    const heatmapData = []; // ECharts 格式: [xIndex, yIndex, value]
    const correlationMatrix = Array(n).fill(0).map(() => Array(n).fill(0));

    // (提取所有科目的分数数组，提高效率)
    // (此 scoresMap 未在此函数中使用, 但保留无害)
    const scoresMap = {};
    subjects.forEach(subject => {
        scoresMap[subject] = activeData.map(s => s.scores[subject]).filter(s => s !== null && s !== undefined);
    });

    //    (逻辑修复)
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {

            let value = 0.0; // (默认值)

            if (i === j) {
                value = 1.0;
                correlationMatrix[i][j] = value;

            } else if (i < j) {
                // (只计算上三角)
                const xSubject = subjects[i];
                const ySubject = subjects[j];

                // (对齐学生)
                const xScores = [];
                const yScores = [];
                activeData.forEach(student => {
                    const xScore = student.scores[xSubject];
                    const yScore = student.scores[ySubject];
                    if (xScore !== null && yScore !== null && xScore !== undefined && yScore !== undefined) {
                        xScores.push(xScore);
                        yScores.push(yScore);
                    }
                });

                const coeff = calculateCorrelation(xScores, yScores);
                value = coeff;
                correlationMatrix[i][j] = value;
                correlationMatrix[j][i] = value; // (矩阵对称)

            } else { // (i > j)
                //    (核心修复)
                // (我们不重  计算, 而是从已存的对称矩阵中检索值)
                value = correlationMatrix[i][j];
            }

            // (现在, push 逻辑在所有分支之后执行, 确保 value 是正确的)
            heatmapData.push([
                i, // X 轴索引
                j, // Y 轴索引
                parseFloat(value.toFixed(2)) // 值
            ]);
        }
    }

    // 2. ECharts 配置 (不变)
    const option = {
        title: {
            text: '学科相关性热力图',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            position: 'top',
            formatter: (params) => {
                const i = params.data[0];
                const j = params.data[1];
                const value = params.data[2];
                return `<strong>${subjects[i]}</strong> vs <strong>${subjects[j]}</strong><br/>` +
                    `相关系数: <strong>${value}</strong>`;
            }
        },
        grid: {
            height: '70%',
            top: '10%',
            bottom: '20%'
        },
        xAxis: {
            type: 'category',
            data: subjects,
            splitArea: { show: true },
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'category',
            data: subjects,
            splitArea: { show: true }
        },
        visualMap: {
            min: -1,
            max: 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '5%',
            inRange: {
                color: ['#dc3545', '#ffffff', '#007bff']
            }
        },
        series: [{
            name: '相关系数',
            type: 'heatmap',
            data: heatmapData,
            label: {
                show: true,
                formatter: (params) => params.data[2]
            },
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }]
    };

    echartsInstances[elementId].setOption(option);
}

// ---------------------------------
// 10. ECharts 绘图函数
// ---------------------------------
/**
 * 10.1. 渲染直方图 (升级版：支持班级对比)
 * - 单班模式：显示高亮柱状图 (Bar)
 * - 对比模式：显示多班折线图 (Line)
 */
function renderHistogram(elementId, students, scoreKey, fullScore, title, binSize, isClassCompare = false) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 1. 基础数据清洗
    if (!students || students.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无数据可供显示。</p>`;
        return;
    }

    const effectiveBinSize = binSize > 0 ? binSize : Math.max(10, Math.ceil(fullScore / 10));
    
    // 2. 确定全局 X 轴范围 (统一坐标系)
    const allScores = students.map(s => (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey])
                              .filter(s => typeof s === 'number' && !isNaN(s));
    
    if (allScores.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无有效分数数据。</p>`;
        return;
    }

    const minScore = Math.min(...allScores);
    const maxScore = Math.max(...allScores);
    const startBin = Math.floor(minScore / effectiveBinSize) * effectiveBinSize;
    const endBinLimit = Math.min(Math.ceil((maxScore + 0.01) / effectiveBinSize) * effectiveBinSize, fullScore);

    const labels = [];
    // 生成 X 轴标签
    for (let i = startBin; i < endBinLimit; i += effectiveBinSize) {
        const end = Math.min(i + effectiveBinSize, fullScore);
        labels.push(`${i}-${end}`);
    }
    // 如果满分正好在区间外，补一个
    if (maxScore === fullScore && labels.length > 0) {
       // 通常上面的逻辑已经涵盖，这里做个保险
    }

    let series = [];
    let legendData = [];
    let tooltipFormatter;

    // ============================================================
    // 模式 A: 班级对比 (多折线图)
    // ============================================================
    if (isClassCompare) {
        const classSet = new Set(students.map(s => s.class));
        const classes = Array.from(classSet).sort();
        const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];

        classes.forEach((cls, idx) => {
            const classStudents = students.filter(s => s.class === cls);
            // 初始化该班的 bins
            const bins = new Array(labels.length).fill(0);

            classStudents.forEach(s => {
                const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
                if (typeof score !== 'number' || isNaN(score) || score < startBin) return;

                let binIndex = Math.floor((score - startBin) / effectiveBinSize);
                // 修正边界
                if (binIndex >= labels.length) binIndex = labels.length - 1;
                bins[binIndex]++;
            });

            series.push({
                name: cls,
                type: 'line',
                smooth: 0.3,
                symbol: 'circle',
                symbolSize: 6,
                data: bins,
                itemStyle: { color: colors[idx % colors.length] },
                lineStyle: { width: 2 }
            });
            legendData.push(cls);
        });

        // 对比模式的 Tooltip
        tooltipFormatter = (params) => {
            let html = `<strong>${params[0].name} 分数段</strong><br/>`;
            // 按人数降序排列
            const sorted = [...params].sort((a, b) => b.value - a.value);
            sorted.forEach(p => {
                if (p.value > 0) {
                    const marker = p.marker || `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${p.color};"></span>`;
                    html += `${marker} ${p.seriesName}: <strong>${p.value}</strong>人<br/>`;
                }
            });
            return html;
        };

    } 
    // ============================================================
    // 模式 B: 单一群体 (原版柱状图)
    // ============================================================
    else {
        const bins = new Array(labels.length).fill(0);
        const binNames = new Array(labels.length).fill(null).map(() => []); // 存储名字

        students.forEach(s => {
            const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
            if (typeof score !== 'number' || isNaN(score) || score < startBin) return;

            let binIndex = Math.floor((score - startBin) / effectiveBinSize);
            if (binIndex >= labels.length) binIndex = labels.length - 1;
            
            bins[binIndex]++;
            binNames[binIndex].push(s.name);
        });

        // 计算极值用于高亮
        let maxVal = Math.max(...bins);
        let minVal = Infinity;
        bins.forEach(v => { if(v > 0 && v < minVal) minVal = v; });
        if (minVal === Infinity) minVal = 0;

        const seriesData = bins.map((count, i) => {
            let color = '#007bff';
            if (count === maxVal && maxVal !== 0) color = '#28a745';
            else if (count === minVal && minVal !== maxVal) color = '#dc3545';
            
            return {
                value: count,
                names: binNames[i], // 存名字用于下钻
                itemStyle: { color: color }
            };
        });

        series.push({
            name: '人数',
            type: 'bar',
            data: seriesData,
            barWidth: '60%',
            label: { show: true, position: 'top' }
        });

        // 单体模式 Tooltip
        tooltipFormatter = (params) => {
            const p = params[0];
            const data = p.data;
            let namesHtml = "";
            if (data.names && data.names.length > 0) {
                namesHtml = `<hr style="margin:5px 0; border-color:#eee"/>` + 
                            data.names.slice(0, 10).join('<br/>');
                if (data.names.length > 10) namesHtml += `<br/>...等 ${data.names.length} 人`;
            }
            return `<strong>${p.name}</strong><br/>人数: <strong>${p.value}</strong>${namesHtml}`;
        };
    }

    // 3. 渲染图表
    const option = {
        title: { text: title, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: tooltipFormatter,
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderColor: '#ccc',
            textStyle: { color: '#333' }
        },
        legend: {
            show: isClassCompare,
            data: legendData,
            top: 30,
            type: 'scroll'
        },
        grid: { left: '3%', right: '4%', bottom: '20%', top: isClassCompare ? '15%' : '10%', containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: '分数段',
            axisLabel: { interval: 'auto', rotate: 30 }
        },
        yAxis: { type: 'value', name: '人数' },
        series: series,
        toolbox: {
            show: true,
            feature: { saveAsImage: { show: true, title: '保存' } }
        }
    };

    myChart.setOption(option, true); // true: 不合并，强制重绘

    // 4. 点击事件 (保留原有的下钻功能)
    // 注意：对比模式下，点击折线图的点比较难定位到具体班级，这里简单处理：
    // 如果是单体模式，继续支持点击看名单；如果是对比模式，暂不支持（或点击显示该分数段所有学生）。
    // 为了代码简洁，这里只保留单体模式的点击，或者通用逻辑。
    
    myChart.off('click'); // 解绑旧事件
    myChart.on('click', function (params) {
        const label = params.name; 
        if (!label || !label.includes('-')) return;

        const [minStr, maxStr] = label.split('-');
        const minVal = parseFloat(minStr);
        const maxVal = parseFloat(maxStr);

        // 确定筛选源
        let targetStudents = students;
        // 如果是对比模式，且点击了某条具体的线，params.seriesName 就是班级名
        if (isClassCompare && params.seriesName) {
            targetStudents = students.filter(s => s.class === params.seriesName);
        }

        const drilled = targetStudents.filter(s => {
            const val = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
            if (typeof val !== 'number') return false;
            // 简单范围判断
            return val >= minVal && val < (maxVal + 0.01); 
        });

        const subTitle = isClassCompare ? `${params.seriesName} - ` : "";
        showDrillDownModal(`${subTitle}${scoreKey} 分数段 [${label}] 名单`, drilled, scoreKey);
    });
}

/**
 * 10.2. 渲染雷达图 (Radar)
 * @param {string} elementId - DOM 元素 ID
 * @param {Object} stats - G_Statistics 对象
 */
function renderAverageRadar(elementId, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const indicators = G_DynamicSubjectList.map(subject => {
        const full = G_SubjectConfigs[subject]?.full || 100;
        return { name: subject, max: full }; // (    ) max 动态读取配置
    });

    const averageData = G_DynamicSubjectList.map(subject => {
        return stats[subject] ? stats[subject].average : 0;
    });

    const option = {
        title: { text: '各科平均分雷达图', left: 'center' },
        tooltip: { trigger: 'item' },
        radar: {
            indicator: indicators,
            radius: 120, // 雷达图大小
        },
        series: [{
            name: '班级平均分',
            type: 'radar',
            data: [{ value: averageData, name: '平均分' }]
        }]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * 10.3. 渲染科目对比条形图 (已重构，移除排序)
 *    已修改：高亮显示最大值和最小值
 *    已修改：标签格式化为 2 位小数
 */
function renderSubjectComparisonBarChart(elementId, stats, metric) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 提取数据
    const data = G_DynamicSubjectList.map(subject => {
        return {
            name: subject,
            value: (stats[subject] && stats[subject][metric] !== undefined) ? stats[subject][metric] : 0
        };
    });

    // 2. 准备ECharts数据
    const labels = data.map(d => d.name);
    const values = data.map(d => d.value);

    //    (    ) 找出最大值和最小值
    let maxValue = -Infinity;
    let minValue = Infinity;
    // (过滤掉 0 或无效值来找最小值，除非全是0)
    const validValues = values.filter(v => v > 0);
    if (validValues.length > 0) {
        minValue = Math.min(...validValues);
    } else {
        minValue = 0; // 如果都是0，最小值就是0
    }
    maxValue = Math.max(...values);

    //    (    ) 准备 Series 数据，用于高亮
    const seriesData = values.map(value => {
        let color;
        if (value === maxValue && maxValue !== 0) {
            color = '#28a745'; // Green
        } else if (value === minValue && minValue !== maxValue) {
            color = '#dc3545'; // Red
        } else {
            color = '#007bff'; // Blue (Default)
        }
        return {
            value: value,
            itemStyle: { color: color }
        };
    });


    // 4. 根据指标确定图表标题
    let titleText = '';
    switch (metric) {
        case 'average': titleText = '各科平均分对比'; break;
        case 'passRate': titleText = '各科及格率对比 (%)'; break;
        case 'excellentRate': titleText = '各科优秀率对比 (%)'; break;
        case 'stdDev': titleText = '各科标准差对比'; break;
        case 'max': titleText = '各科最高分对比'; break;
        case 'difficulty': titleText = '各科难度系数对比'; break;
        default: titleText = '科目对比';
    }

    const option = {
        title: { text: titleText, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: labels, name: '科目', axisLabel: { rotate: 30 } },
        yAxis: { type: 'value', name: metric.includes('Rate') ? '%' : '分数' },
        series: [{
            name: titleText,
            type: 'bar',
            data: seriesData, //    使用  的 seriesData
            barWidth: '60%',
            label: {
                show: true,
                position: 'top',
                formatter: (params) => parseFloat(params.value).toFixed(2)
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (    ) 10.4. 渲染班级对比条形图
 *    已修改：高亮显示最大值(绿色)和最小值(红色)
 */
function renderClassComparisonChart(elementId, data, title) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    //      找出最大值和最小值
    let maxValue = -Infinity;
    let minValue = Infinity;
    const values = data.map(d => d.value);

    const validValues = values.filter(v => v > 0);
    if (validValues.length > 0) {
        minValue = Math.min(...validValues);
    } else {
        minValue = 0;
    }
    maxValue = Math.max(...values);


    // 2. 准备 ECharts 数据
    const labels = data.map(d => d.name);

    //      将 'values' 数组转换为包含自定义样式的 'seriesData' 数组
    const seriesData = data.map(d => {
        const isMax = (d.value === maxValue && maxValue !== 0);
        const isMin = (d.value === minValue && minValue !== maxValue);

        let color;
        if (isMax) {
            color = '#28a745'; // Green
        } else if (isMin) {
            color = '#dc3545'; // Red
        } else {
            color = '#007bff'; // Blue (Default)
        }

        return {
            value: d.value,
            itemStyle: { color: color }
        };
    });


    const option = {
        title: { text: title, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: '班级',
            axisLabel: {
                interval: 0,
                rotate: 30
            }
        },
        yAxis: { type: 'value', name: '数值' },
        series: [{
            name: title,
            type: 'bar',
            data: seriesData, //      使用  的 seriesData
            barWidth: '60%',
            label: {
                show: true,
                position: 'top',
                formatter: (params) => parseFloat(params.value).toFixed(1)
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 *    10.5. 渲染多科目箱形图
 *      手动计算箱形图数据，以便在异常值中显示学生姓名
 * @param {string} elementId
 * @param {Object} stats - G_Statistics
 * @param {Array} activeData - 传入学生数据
 */
function renderSubjectBoxPlot(elementId, stats, activeData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1.    (    ) 辅助函数：手动计算分位数
    const getQuartiles = (scores) => {
        if (!scores || scores.length === 0) return { q1: 0, q2: 0, q3: 0 };
        // (注意) stats.scores 已经是排好序的
        const n = scores.length;
        const q1Index = Math.floor(n * 0.25);
        const q2Index = Math.floor(n * 0.5);
        const q3Index = Math.floor(n * 0.75);
        return {
            q1: scores[q1Index],
            q2: scores[q2Index], // 中位数
            q3: scores[q3Index]
        };
    };

    const boxData = [];    // 存储箱体数据
    const scatterData = []; // 存储异常值数据 (带姓名)
    const labels = G_DynamicSubjectList;

    // 2.      遍历所有科目
    labels.forEach((subject, subjectIndex) => {
        const s = stats[subject];
        // (如果该科目没有数据，跳过)
        if (!s || !s.scores || s.scores.length === 0) return;

        // 2.1 计算四分位数和 IQR (箱体)
        const { q1, q2, q3 } = getQuartiles(s.scores);
        const iqr = q3 - q1;

        // 2.2 计算上下限 (胡须)
        const lowerWhiskerLimit = q1 - 1.5 * iqr;
        const upperWhiskerLimit = q3 + 1.5 * iqr;

        // 2.3 找到胡须的实际位置 (在限制内的真实 min/max)
        let actualMin = Infinity;
        let actualMax = -Infinity;
        s.scores.forEach(score => {
            if (score >= lowerWhiskerLimit && score < actualMin) actualMin = score;
            if (score <= upperWhiskerLimit && score > actualMax) actualMax = score;
        });
        // (处理极端情况，如果所有值都是异常值)
        if (actualMin === Infinity) actualMin = q1;
        if (actualMax === -Infinity) actualMax = q3;

        // 2.4 添加箱体数据
        // ECharts 格式: [min, q1, q2, q3, max]
        boxData.push([actualMin, q1, q2, q3, actualMax]);

        // 2.5 (核心) 遍历 activeData 查找异常值学生
        activeData.forEach(student => {
            const score = student.scores[subject];
            if (score !== null && score !== undefined) {
                // (如果分数在胡须之外，则为异常值)
                if (score > upperWhiskerLimit || score < lowerWhiskerLimit) {
                    scatterData.push({
                        name: `${student.name} (${student.class})`, //    (    ) 存储学生信息
                        value: [subjectIndex, score] // [X轴索引, Y轴分数]
                    });
                }
            }
        });
    });

    // 3.    (删除) 移除 dataTool
    // const allScores = ...
    // const boxplotData = echarts.dataTool.prepareBoxplotData(allScores);

    // 4.   ECharts 配置
    const option = {
        title: {
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            axisPointer: { type: 'shadow' }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: labels, //    (修改)
            boundaryGap: true,
            nameGap: 30,
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '分数',
            splitArea: { show: true }
        },
        series: [
            {
                name: '箱形图',
                type: 'boxplot',
                data: boxData, //    (修改)
                tooltip: {
                    formatter: function (param) {
                        // param.data[0] 是 xAxis 索引, param.data[1-5] 是 [min, q1, q2, q3, max]
                        return [
                            '<strong>' + labels[param.dataIndex] + '</strong>',
                            '最大值 (上须): ' + param.data[5],
                            '上四分位 (Q3): ' + param.data[4],
                            '中位数 (Q2): ' + param.data[3],
                            '下四分位 (Q1): ' + param.data[2],
                            '最小值 (下须): ' + param.data[1]
                        ].join('<br/>');
                    }
                }
            },
            {
                name: '异常值',
                type: 'scatter',
                data: scatterData, //    (修改)
                //    (    ) 为异常值定制 Tooltip
                tooltip: {
                    formatter: function (param) {
                        // param.data 是 { name: '...', value: [...] }
                        return `<strong>${param.data.name}</strong><br/>` +
                            `${labels[param.data.value[0]]}: <strong>${param.data.value[1]}</strong>分`;
                    }
                }
            }
        ],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}
/**
 * 10.6. 渲染学科关联性散点图
 * 现在调用 calculateCorrelation() 辅助函数
 */
function renderCorrelationScatterPlot(elementId, activeData, xSubject, ySubject) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom || !activeData) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备数据: [ [xScore, yScore], ... ]
    const scatterData = [];
    const xScores = []; // (用于计算相关系数)
    const yScores = []; // (用于计算相关系数)

    activeData.forEach(student => {
        const xScore = student.scores[xSubject];
        const yScore = student.scores[ySubject];

        if (xScore !== null && yScore !== null && xScore !== undefined && yScore !== undefined) {
            scatterData.push([xScore, yScore]);
            xScores.push(xScore);
            yScores.push(yScore);
        }
    });
    const correlationCoefficient = calculateCorrelation(xScores, yScores);
    const formattedCorrelation = correlationCoefficient.toFixed(2);

    // 3. 确定图表的 X/Y 轴最大值
    const maxX = G_SubjectConfigs[xSubject]?.full || 150;
    const maxY = G_SubjectConfigs[ySubject]?.full || 150;

    const option = {
        title: {
            text: `${xSubject} vs ${ySubject} 成绩关联性 (相关系数: ${formattedCorrelation})`,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        grid: { left: '10%', right: '10%', bottom: '15%', top: '15%' },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.seriesType === 'scatter') {
                    return `学生分数<br/>${xSubject}: ${params.data[0]}分<br/>${ySubject}: ${params.data[1]}分`;
                }
                return params.name;
            }
        },
        xAxis: {
            type: 'value',
            name: xSubject,
            min: 0,
            max: maxX,
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: ySubject,
            min: 0,
            max: maxY,
            splitLine: { show: false }
        },
        series: [{
            name: '学生',
            type: 'scatter',
            data: scatterData,
            symbolSize: 6,
            emphasis: {
                focus: 'series'
            },
            itemStyle: {
                opacity: 0.6
            },

            markLine: {
                silent: true,
                animation: false,
                lineStyle: {
                    color: '#9932CC',
                    type: 'dashed',
                    width: 2
                },
                symbol: 'none',
                data: [
                    [
                        {
                            name: '比例线',
                            coord: [0, 0],
                            label: { show: false }
                        },
                        {
                            coord: [maxX, maxY],
                            label: {
                                show: true,
                                formatter: '比例线',
                                position: 'end',
                                color: '#9932CC'
                            }
                        }
                    ]
                ]
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };

    echartsInstances[elementId].setOption(option, true);
}


/**
 * 10.7. 渲染 A/B/C/D 堆叠百分比条形图
 * A/B/C/D 的分界线现在从 config.good 读取
 */
function renderStackedBar(elementId, stats, configs) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    const categories = G_DynamicSubjectList;

    let aData = []; // A (优秀)
    let bData = []; // B (良好)
    let cData = []; // C (及格)
    let dData = []; // D (不及格)

    categories.forEach(subject => {
        const s = stats[subject];
        const config = configs[subject];

        if (!s || !config || !s.scores || s.scores.length === 0) {
            aData.push(0);
            bData.push(0);
            cData.push(0);
            dData.push(0);
            return;
        }

        const excelLine = config.excel;
        const passLine = config.pass;
        //    核心修正：从配置中读取可定义的 "良好线"
        const goodLine = config.good;
        const totalCount = s.scores.length;

        let countA = 0;
        let countB = 0;
        let countC = 0;
        let countD = 0;

        // 遍历该科目的所有分数，进行 4 级分箱
        s.scores.forEach(score => {
            if (score >= excelLine) {
                countA++;
            } else if (score >= goodLine) { // (已低于 excelLine)
                countB++;
            } else if (score >= passLine) { // (已低于 goodLine)
                countC++;
            } else { // (已低于 passLine)
                countD++;
            }
        });

        // 转换为百分比
        aData.push(parseFloat(((countA / totalCount) * 100).toFixed(1)));
        bData.push(parseFloat(((countB / totalCount) * 100).toFixed(1)));
        cData.push(parseFloat(((countC / totalCount) * 100).toFixed(1)));
        dData.push(parseFloat(((countD / totalCount) * 100).toFixed(1)));
    });

    const option = {
        title: {
            text: '各科 A/B/C/D 构成 (百分比)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                let tooltipHtml = `<strong>${params[0].name}</strong><br/>`;
                params.reverse().forEach(p => {
                    tooltipHtml += `${p.marker} ${p.seriesName}: ${p.value.toFixed(1)}%<br/>`;
                });
                return tooltipHtml;
            }
        },
        legend: { top: 30 },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            data: categories,
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '百分比 (%)',
            min: 0,
            max: 100
        },
        series: [
            {
                name: 'D (不及格)',
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: dData,
                color: '#dc3545' // (var(--color-red))
            },
            {
                name: 'C (及格)',
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: cData,
                color: '#ffc107' // (var(--color-yellow))
            },
            {
                name: 'B (良好)',
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: bData,
                color: '#007bff' // (var(--color-blue))
            },
            {
                name: 'A (优秀)',
                type: 'bar',
                stack: 'total',
                barWidth: '60%',
                emphasis: { focus: 'series' },
                data: aData,
                color: '#28a745' // (var(--color-green))
            }
        ],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 *    10.8. 渲染学生个体 vs 年级平均雷达图
 *        了颜色区分
 */
function renderStudentRadar(elementId, student, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备雷达图指示器 (max 设为 100, 因为我们用得分率)
    const indicators = G_DynamicSubjectList.map(subject => {
        return { name: subject, max: 100 };
    });

    // 2. 计算 "学生得分率"
    const studentData = G_DynamicSubjectList.map(subject => {
        const score = student.scores[subject] || 0;
        const full = G_SubjectConfigs[subject]?.full;
        if (!full || full === 0) return 0; // 避免除以零
        return parseFloat(((score / full) * 100).toFixed(1));
    });

    // 3. 计算 "年级平均得分率"
    const averageData = G_DynamicSubjectList.map(subject => {
        const avgScore = stats[subject]?.average || 0;
        const full = G_SubjectConfigs[subject]?.full;
        if (!full || full === 0) return 0; // 避免除以零
        return parseFloat(((avgScore / full) * 100).toFixed(1));
    });

    const option = {
        title: {
            text: '学生 vs 年级平均 (得分率 %)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                let s = `<strong>${params.name}</strong><br/>`;
                //    修正：tooltip 中也显示对应的颜色标记
                let studentColor = '#28a745'; // 学生的颜色
                let averageColor = '#007bff'; // 年级平均的颜色

                if (params.seriesName === '学生 vs 年级平均') {
                    // 当 hover 到线段时，params.value[0]是学生数据，params.value[1]是年级平均数据
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${studentColor};"></span> 学生: ${studentData[params.dataIndex]}%<br/>`;
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${averageColor};"></span> 年级平均: ${averageData[params.dataIndex]}%`;
                } else if (params.seriesName === '学生') { // 直接hover到“学生”的图例
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${studentColor};"></span> ${params.name}: ${params.value}%`;
                } else if (params.seriesName === '年级平均') { // 直接hover到“年级平均”的图例
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${averageColor};"></span> ${params.name}: ${params.value}%`;
                }
                return s;
            }
        },
        legend: {
            data: ['学生', '年级平均'],
            bottom: 10
        },
        radar: {
            indicator: indicators,
            radius: '65%', // 雷达图大小
            splitArea: {
                areaStyle: {
                    color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
                }
            }
        },
        series: [{
            name: '学生 vs 年级平均',
            type: 'radar',
            //    添加颜色配置
            itemStyle: {
                color: '#28a745' // 学生线的颜色 (绿色)
            },
            lineStyle: {
                color: '#28a745' // 学生线的颜色 (绿色)
            },
            data: [
                {
                    value: studentData,
                    name: '学生',
                    //    添加区域颜色
                    areaStyle: {
                        opacity: 0.4,
                        color: '#28a745' // 学生区域的颜色 (绿色)
                    },
                    itemStyle: { // 单独为学生数据点设置颜色
                        color: '#28a745'
                    },
                    lineStyle: { // 单独为学生数据线设置颜色
                        color: '#28a745'
                    }
                },
                {
                    value: averageData,
                    name: '年级平均',
                    //    添加区域颜色
                    areaStyle: {
                        opacity: 0.2,
                        color: '#007bff' // 年级平均区域的颜色 (蓝色)
                    },
                    itemStyle: { // 单独为年级平均数据点设置颜色
                        color: '#007bff'
                    },
                    lineStyle: { // 单独为年级平均数据线设置颜色
                        color: '#007bff'
                    }
                }
            ]
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}


/**
 * (    ) 10.9. 渲染 难度-区分度 散点图
 * (用于试卷科目分析模块)
 * @param {string} elementId - DOM 元素 ID
 * @param {Object} stats - G_Statistics
 */
/**
 * (    ) 10.9. 渲染 难度-区分度 散点图 (修复版：带十字象限线)
 *         markLine 功能，自动画出平均线，形成四个象限
 */
function renderDifficultyScatter(elementId, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备数据
    const scatterData = G_DynamicSubjectList.map(subject => {
        const s = stats[subject];
        if (!s) return null;

        const fullMark = G_SubjectConfigs[subject]?.full || 100;
        // 气泡大小缩放逻辑
        const bubbleSize = Math.sqrt(fullMark) * 2.5;

        return {
            name: subject,
            value: [
                s.difficulty,  // X: 难度
                s.stdDev,      // Y: 区分度
                bubbleSize,    // Size
                subject        // Name
            ],
            //    给气泡加个颜色，语数英深一点
            itemStyle: {
                color: (['语文', '数学', '英语'].includes(subject)) ? '#007bff' : '#6cb2eb',
                opacity: 0.8
            }
        };
    }).filter(d => d !== null);

    // 2. 渲染图表
    const option = {
        title: {
            text: '难度 (X) vs 区分度 (Y)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255,255,255,0.9)',
            formatter: (params) => {
                const data = params.data;
                // params.value: [难度, 区分度, 大小, 科目]
                return `<strong>${data.value[3]}</strong><br/>` +
                    `难度系数: <strong>${data.value[0]}</strong> (越右越简单)<br/>` +
                    `区分度: <strong>${data.value[1]}</strong> (越上越拉分)`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '15%', top: '15%' },
        xAxis: {
            type: 'value',
            name: '难度 (简单 →)',
            nameLocation: 'end',
            min: 0,
            max: 1.0,
            splitLine: { show: false } // 隐藏默认网格，为了看清十字线
        },
        yAxis: {
            type: 'value',
            name: '区分度 (拉分 ↑)',
            nameLocation: 'end',
            splitLine: { show: false } // 隐藏默认网格
        },
        series: [{
            name: '科目',
            type: 'scatter',
            data: scatterData,
            symbolSize: (data) => data[2],
            label: {
                show: true,
                formatter: (param) => param.data.name,
                position: 'top',
                color: '#333',
                fontWeight: 'bold'
            },
            //    核心修改    添加十字辅助线 (MarkLine)
            markLine: {
                silent: true, // 鼠标放上去不触发效果
                symbol: 'none', // 不要箭头
                lineStyle: {
                    type: 'dashed',
                    color: '#999',
                    width: 1.5
                },
                label: {
                    show: true,
                    position: 'end', // 文字显示在线的末端
                    formatter: '{b}: {c}'
                },
                data: [
                    // 1. 垂直线 (X轴平均值 - 平均难度)
                    {
                        type: 'average',
                        valueDim: 'x',
                        name: '平均难度',
                        label: { position: 'start', formatter: '平均难度\n{c}' }
                    },
                    // 2. 水平线 (Y轴平均值 - 平均区分度)
                    {
                        type: 'average',
                        valueDim: 'y',
                        name: '平均区分度',
                        label: { position: 'end', formatter: '平均区分度 {c}' }
                    }
                ]
            },
            //    可选    添加四个象限的背景色 (让分区更明显)
            markArea: {
                silent: true,
                itemStyle: { opacity: 0.05 }, // 非常淡的背景
                data: [
                    // 左上 (难+拉分) - 红色警示
                    [
                        { xAxis: 0, yAxis: 'average', itemStyle: { color: '#ff0000' } },
                        { xAxis: 'average', yAxis: 100 } // 100是Y轴无限大
                    ],
                    // 右上 (易+拉分) - 绿色理想
                    [
                        { xAxis: 'average', yAxis: 'average', itemStyle: { color: '#008000' } },
                        { xAxis: 1, yAxis: 100 }
                    ]
                ]
            }
        }],
        toolbox: {
            show: true,
            feature: { saveAsImage: { show: true, title: '保存' } }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (    ) 10.10. 渲染进退步散点图 (Barbell Plot)
 * (用于成绩趋势对比模块)
 */
function renderTrendScatter(elementId, students) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤掉没有对比数据的学生，并按  排名排序
    const data = students
        .filter(s => s.oldRank !== null)
        .sort((a, b) => a.rank - b.rank); // 按  排名升序

    const studentNames = data.map(s => s.name);

    // 2. 准备 "上次排名" 和 "本次排名" 的数据
    const oldRankData = data.map((s, index) => [s.oldRank, index]);
    const newRankData = data.map((s, index) => [s.rank, index]);

    // 3. 准备 "连接线" (Barbell) 的数据
    const lineData = data.map((s, index) => {
        const color = s.rankDiff > 0 ? '#28a745' : s.rankDiff < 0 ? '#dc3545' : '#aaa'; // 绿 / 红 / 灰
        return {
            coords: [[s.oldRank, index], [s.rank, index]],
            lineStyle: { color: color, width: 1.5 }
        };
    });

    const option = {
        title: {
            text: '班级排名 进退步一览',
            subtext: '按本次班排 (Y轴) 排序',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                const dataIndex = params.data[1]; // Y 轴的索引
                const student = data[dataIndex];
                if (!student) return;

                let change = student.rankDiff > 0
                    ? `<strong style="color: #28a745;">进步 ${student.rankDiff} 名</strong>`
                    : student.rankDiff < 0
                        ? `<strong style="color: #dc3545;">退步 ${Math.abs(student.rankDiff)} 名</strong>`
                        : '排名不变';

                return `<strong>${student.name} (${student.id})</strong><br/>` +
                    `本次排名: ${student.rank}<br/>` +
                    `上次排名: ${student.oldRank}<br/>` +
                    `<strong>${change}</strong>`;
            }
        },
        grid: { left: '3%', right: '10%', bottom: '8%', containLabel: true },
        xAxis: {
            type: 'value',
            name: '班级排名',
            position: 'top',
            splitLine: { show: true },
            axisLine: { show: true },
            min: 0,
            inverse: true //    排名 1 在右侧
        },
        yAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: { show: false }, //    姓名太多, 默认隐藏 (见 CSS)
            axisTick: { show: false }
        },
        series: [
            {
                name: '上次排名',
                type: 'scatter',
                data: oldRankData,
                symbolSize: 8,
                itemStyle: { color: '#aaa' }
            },
            {
                name: '本次排名',
                type: 'scatter',
                data: newRankData,
                symbolSize: 8,
                itemStyle: { color: '#007bff' }
            },
            {
                name: '进退',
                type: 'lines',
                data: lineData,
                symbol: 'none',
                silent: true // 线条不响应鼠标
            }
        ]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 *    10.11. 渲染学生进退步条形图
 *    修复版：支持按【年级排名变化】排序
 */
function renderRankChangeBarChart(elementId, students, sortBy = 'name', subject = 'totalScore') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备数据：计算指定科目的排名变化
    let chartData = students.map(s => {
        let classDiff = 0;
        let gradeDiff = 0;
        let valid = false; // 标记是否有对比数据

        if (subject === 'totalScore') {
            // 总分逻辑 (直接用算好的)
            if (s.oldRank !== null) {
                classDiff = s.rankDiff;
                gradeDiff = s.gradeRankDiff;
                valid = true;
            }
        } else {
            // 单科逻辑
            const oldCR = s.oldClassRanks ? s.oldClassRanks[subject] : null;
            const newCR = s.classRanks ? s.classRanks[subject] : null;
            
            const oldGR = s.oldGradeRanks ? s.oldGradeRanks[subject] : null;
            const newGR = s.gradeRanks ? s.gradeRanks[subject] : null;

            if (oldCR !== null && newCR !== null) {
                classDiff = oldCR - newCR;
                valid = true;
            }
            if (oldGR !== null && newGR !== null) {
                gradeDiff = oldGR - newGR;
            }
        }

        return {
            name: s.name,
            rank: s.rank, // 用于排序
            displayClassDiff: classDiff,
            displayGradeDiff: gradeDiff,
            valid: valid
        };
    }).filter(item => item.valid);

    // 2. 排序
    const sortOption = sortBy.split('_');
    const sortKey = sortOption[0]; // 'name', 'rankDiff', 'gradeRankDiff'
    const sortDir = sortOption[1] || 'asc';

    chartData.sort((a, b) => {
        if (sortKey === 'name') {
            return a.name.localeCompare(b.name);
        } 
        else if (sortKey === 'rankDiff') {
            // 按【班级排名】变化排序
            // desc: 进步最多优先 (正数大在前); asc: 退步最多优先 (负数小在前)
            return sortDir === 'asc' 
                ? a.displayClassDiff - b.displayClassDiff 
                : b.displayClassDiff - a.displayClassDiff;
        } 
        else if (sortKey === 'gradeRankDiff') {
            // [    ] 按【年级排名】变化排序
            return sortDir === 'asc' 
                ? a.displayGradeDiff - b.displayGradeDiff 
                : b.displayGradeDiff - a.displayGradeDiff;
        }
        return 0;
    });

    // 3. 准备 ECharts 数据
    const studentNames = chartData.map(s => s.name);
    const classRankDiffs = chartData.map(s => s.displayClassDiff);
    const gradeRankDiffs = chartData.map(s => s.displayGradeDiff);

    const subjectText = (subject === 'totalScore') ? '总分' : subject;
    
    // 动态显示副标题
    let subTextStr = "排序方式: 姓名";
    if (sortKey === 'rankDiff') subTextStr = `排序方式: 班排${sortDir === 'desc' ? '进步' : '退步'}幅度`;
    if (sortKey === 'gradeRankDiff') subTextStr = `排序方式: 年排${sortDir === 'desc' ? '进步' : '退步'}幅度`;

    const option = {
        title: {
            text: `学生 ${subjectText} 班排/年排 变化`,
            subtext: subTextStr,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const studentName = params[0].name;
                let tip = `<strong>${studentName} (${subjectText})</strong><br/>`;
                params.forEach(p => {
                    const value = p.value;
                    const change = value > 0 ? `进步 ${value} 名` : (value < 0 ? `退步 ${Math.abs(value)} 名` : '不变');
                    tip += `${p.marker} ${p.seriesName}: ${change}<br/>`;
                });
                return tip;
            }
        },
        legend: {
            data: ['班排变化', '年排变化'],
            top: 50
        },
        grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, top: 100 },
        xAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: { rotate: 30, interval: 0 }
        },
        yAxis: {
            type: 'value',
            name: '排名变化 (正数为进步)'
        },
        dataZoom: [
            { type: 'inside', xAxisIndex: [0] },
            { type: 'slider', xAxisIndex: [0], bottom: 10, height: 20 }
        ],
        series: [
            {
                name: '班排变化',
                type: 'bar',
                barWidth: '40%',
                emphasis: { focus: 'series' },
                data: classRankDiffs,
                itemStyle: { color: '#007bff' }
            },
            {
                name: '年排变化',
                type: 'bar',
                barWidth: '40%',
                emphasis: { focus: 'series' },
                data: gradeRankDiffs,
                itemStyle: { color: '#ffc107' }
            }
        ]
    };
    
    option.grid.bottom = (chartData.length > 20 ? 50 : 30) + 'px';
    option.dataZoom[1].bottom = 10;

    echartsInstances[elementId].setOption(option);
}

/**
 *    10.11. 渲染学生进退步条形图
 *    修复版：支持按【年级排名变化】排序
 * 务必更  此函数，否则下拉框选了没反应！
 */
function renderRankChangeBarChart(elementId, students, sortBy = 'name', subject = 'totalScore') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备数据：计算指定科目的排名变化
    let chartData = students.map(s => {
        let classDiff = 0;
        let gradeDiff = 0;
        let valid = false; // 标记是否有对比数据

        if (subject === 'totalScore') {
            // 总分逻辑 (直接用算好的)
            if (s.oldRank !== null && s.oldRank !== undefined) {
                classDiff = s.rankDiff;
                gradeDiff = s.gradeRankDiff;
                valid = true;
            }
        } else {
            // 单科逻辑
            const oldCR = s.oldClassRanks ? s.oldClassRanks[subject] : null;
            const newCR = s.classRanks ? s.classRanks[subject] : null;
            
            const oldGR = s.oldGradeRanks ? s.oldGradeRanks[subject] : null;
            const newGR = s.gradeRanks ? s.gradeRanks[subject] : null;

            if (oldCR !== null && newCR !== null && oldCR !== undefined && newCR !== undefined) {
                classDiff = oldCR - newCR;
                valid = true;
            }
            if (oldGR !== null && newGR !== null && oldGR !== undefined && newGR !== undefined) {
                gradeDiff = oldGR - newGR;
            }
        }

        return {
            name: s.name,
            rank: s.rank, // 用于排序
            displayClassDiff: classDiff,
            displayGradeDiff: gradeDiff,
            valid: valid
        };
    }).filter(item => item.valid);

    // 2. 排序核心逻辑 [关键修复点]
    const sortOption = sortBy.split('_');
    const sortKey = sortOption[0]; // 'name', 'rankDiff', 'gradeRankDiff'
    const sortDir = sortOption[1] || 'asc';

    chartData.sort((a, b) => {
        if (sortKey === 'name') {
            return a.name.localeCompare(b.name);
        } 
        else if (sortKey === 'rankDiff') {
            // 按【班级排名】变化排序
            return sortDir === 'asc' 
                ? a.displayClassDiff - b.displayClassDiff 
                : b.displayClassDiff - a.displayClassDiff;
        } 
        else if (sortKey === 'gradeRankDiff') {
            // [    ] 按【年级排名】变化排序
            return sortDir === 'asc' 
                ? a.displayGradeDiff - b.displayGradeDiff 
                : b.displayGradeDiff - a.displayGradeDiff;
        }
        return 0;
    });

    // 3. 准备 ECharts 数据
    const studentNames = chartData.map(s => s.name);
    const classRankDiffs = chartData.map(s => s.displayClassDiff);
    const gradeRankDiffs = chartData.map(s => s.displayGradeDiff);

    const subjectText = (subject === 'totalScore') ? '总分' : subject;
    
    // 动态显示副标题
    let subTextStr = "当前排序: 姓名";
    if (sortKey === 'rankDiff') subTextStr = `当前排序: 班排${sortDir === 'desc' ? '进步' : '退步'}幅度`;
    if (sortKey === 'gradeRankDiff') subTextStr = `当前排序: 年排${sortDir === 'desc' ? '进步' : '退步'}幅度`;

    const option = {
        title: {
            text: `学生 ${subjectText} 班排/年排 变化`,
            subtext: subTextStr,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const studentName = params[0].name;
                let tip = `<strong>${studentName} (${subjectText})</strong><br/>`;
                params.forEach(p => {
                    const value = p.value;
                    const change = value > 0 ? `进步 ${value} 名` : (value < 0 ? `退步 ${Math.abs(value)} 名` : '不变');
                    tip += `${p.marker} ${p.seriesName}: ${change}<br/>`;
                });
                return tip;
            }
        },
        legend: {
            data: ['班排变化', '年排变化'],
            top: 50
        },
        grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, top: 100 },
        xAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: { rotate: 30, interval: 0 }
        },
        yAxis: {
            type: 'value',
            name: '排名变化 (正数为进步)'
        },
        dataZoom: [
            { type: 'inside', xAxisIndex: [0] },
            { type: 'slider', xAxisIndex: [0], bottom: 10, height: 20 }
        ],
        series: [
            {
                name: '班排变化',
                type: 'bar',
                barWidth: '40%',
                emphasis: { focus: 'series' },
                data: classRankDiffs,
                itemStyle: { color: '#007bff' }
            },
            {
                name: '年排变化',
                type: 'bar',
                barWidth: '40%',
                emphasis: { focus: 'series' },
                data: gradeRankDiffs,
                itemStyle: { color: '#ffc107' }
            }
        ]
    };
    
    // 自动调整底部高度以适应人名
    option.grid.bottom = (chartData.length > 20 ? 50 : 30) + 'px';
    option.dataZoom[1].bottom = 10;

    echartsInstances[elementId].setOption(option);
}

/**
 * (    ) 10.16. [辅助函数] 计算偏科分析数据
 * (这是  模块的核心)
 */
//      接收 G_Statistics
function calculateWeaknessData(students, stats) {

    // (辅助函数)
    const mean = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const validArr = arr.filter(v => typeof v === 'number' && !isNaN(v)); //    (健壮性)
        if (validArr.length === 0) return 0;
        return validArr.reduce((sum, val) => sum + val, 0) / validArr.length;
    };
    const stdDev = (arr, meanVal) => {
        if (!arr || arr.length < 2) return 0;
        const validArr = arr.filter(v => typeof v === 'number' && !isNaN(v)); //    (健壮性)
        if (validArr.length < 2) return 0;
        return Math.sqrt(validArr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / validArr.length);
    };

    const results = [];

    students.forEach(student => {
        // 1.      计算该生的所有 "Z-Score" (标准分)
        const zScores = [];
        const validSubjects = [];

        G_DynamicSubjectList.forEach(subject => {
            const subjectStat = stats[subject];
            const score = student.scores[subject];

            // (必须有分数, 且该科目有统计数据, 且标准差不为0)
            if (subjectStat && subjectStat.stdDev > 0 && score !== null && score !== undefined) {
                const z = (score - subjectStat.average) / subjectStat.stdDev;
                zScores.push(z);
                validSubjects.push(subject);
            }
        });

        if (zScores.length < 2) {
            results.push(null); // (数据不足，无法分析偏科)
            return;
        }

        // 2.      计算该生的 "平均Z-Score" 和 "Z-Score标准差" (即偏科程度)
        const avgZScore = mean(zScores);
        const stdDevZScore = stdDev(zScores, avgZScore);

        // 3.      计算每科的 "Z-Score偏离度"
        const subjectDeviations = [];
        zScores.forEach((z, index) => {
            const subject = validSubjects[index];
            subjectDeviations.push({
                subject: subject,
                zScore: parseFloat(z.toFixed(2)), //    该科Z分
                deviation: parseFloat((z - avgZScore).toFixed(2)) //    偏离度
            });
        });

        results.push({
            student: student,
            avgZScore: parseFloat(avgZScore.toFixed(2)), //    (  ) 学生综合能力 (Z分均值)
            stdDevZScore: parseFloat(stdDevZScore.toFixed(2)), //    (  ) 学生偏科程度 (Z分标准差)
            subjectDeviations: subjectDeviations
        });
    });

    return results.filter(r => r !== null); // 过滤掉无法分析的学生
}


/**
 * (最终修复版 V4 - 完美版) 解决 MarkLine、四色渲染、queryComponents 错误，并实现 X 轴动态缩放。
 */
//      接收 G_Statistics
function renderWeaknessScatter(elementId, weaknessData, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 辅助函数: 计算平均值
    const mean = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const validArr = arr.filter(val => typeof val === 'number' && !isNaN(val));
        if (validArr.length === 0) return 0;
        return validArr.reduce((sum, val) => sum + val, 0) / validArr.length;
    };

    // 1.      计算平均线
    // Z-Score 的均值理论上为 0
    const avgZScoreLine = 0;
    // 偏科程度的均值
    const yValues = weaknessData.map(d => d.stdDevZScore).filter(v => typeof v === 'number' && !isNaN(v));
    const avgStdDev = mean(yValues);

    // 2. 数据预处理
    const quadrantData = { '右上': [], '左上': [], '右下': [], '左下': [] };
    const xValuesRaw = [];
    const yValuesRaw = [];

    weaknessData.forEach(data => {
        //      使用 Z-Score
        const x = data.avgZScore;
        const y = data.stdDevZScore;
        const studentName = data.student.name;

        if (typeof x !== 'number' || isNaN(x) || typeof y !== 'number' || isNaN(y)) return;

        xValuesRaw.push(x);
        yValuesRaw.push(y);

        const quadrantKey = (x >= avgZScoreLine ? '右' : '左') + (y >= avgStdDev ? '上' : '下');
        quadrantData[quadrantKey].push([x, y, studentName]);
    });

    // 3. 🚀      动态计算坐标轴范围 (Z-Score)
    // Z-Scores 是围绕 0 对称的
    const min_X = xValuesRaw.length > 0 ? Math.min(...xValuesRaw) : -2;
    const max_X = xValuesRaw.length > 0 ? Math.max(...xValuesRaw) : 2;
    const max_Y = yValuesRaw.length > 0 ? Math.max(...yValuesRaw) : 1.5;

    // X 轴动态范围, 至少 -2 到 2
    const dynamicMinX = Math.floor(Math.min(-0.5, min_X * 1.1) / 0.5) * 0.5;
    const dynamicMaxX = Math.ceil(Math.max(0.5, max_X * 1.1) / 0.5) * 0.5;
    // Y 轴动态范围
    const dynamicMaxY = Math.ceil(Math.max(0.5, max_Y * 1.1) / 0.5) * 0.5;

    // 4. 定义颜色和文本 (保持不变)
    const quadrantColors = {
        '右上': '#dc3545', '左上': '#ffc107', '右下': '#28a745', '左下': '#17a2b8'
    };
    const quadrantLabels = {
        '右上': '尖子生但有短板\n(重点关注)', '左上': '基础差且有\n极大短板',
        '右下': '学霸/全能型', '左下': '基础薄弱但\n各科均衡'
    };

    // 5. 初始 Option (不包含 graphic)
    const initialOption = {
        title: { text: '学生能力-均衡度 四象限图 (Z-Score)', left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.componentType === 'graphic') return '';
                const data = params.data;
                //      更   Tooltip
                return `<strong>${data[2]}</strong><br/>` +
                    `综合能力 (Z-Score均值): ${data[0].toFixed(2)}<br/>` +
                    `偏科程度 (Z-Score标准差): ${data[1].toFixed(2)}`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '10%', top: '10%' },
        xAxis: {
            type: 'value',
            //      更   X 轴
            name: '综合能力 (平均Z-Score)',
            nameLocation: 'middle',
            nameGap: 30,
            min: dynamicMinX,
            max: dynamicMaxX
        },
        //      更   Y 轴
        yAxis: { type: 'value', name: '偏科程度 (Z-Score标准差)', nameLocation: 'middle', nameGap: 40, min: 0, max: dynamicMaxY },

        series: [
            // 四个散点图系列 (保持不变)
            { name: '右上象限', type: 'scatter', data: quadrantData['右上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右上'] } },
            { name: '左上象限', type: 'scatter', data: quadrantData['左上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左上'] } },
            { name: '右下象限', type: 'scatter', data: quadrantData['右下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右下'] } },
            { name: '左下象限', type: 'scatter', data: quadrantData['左下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左下'] } },

            //      更  辅助 MarkLine
            {
                name: '辅助线', type: 'scatter', data: [],
                markLine: {
                    silent: true, animation: false, symbol: 'none',
                    lineStyle: { type: 'dashed', color: 'red' },
                    data: [
                        { xAxis: avgZScoreLine, name: '年级平均线', label: { formatter: '年级平均(0)' } },
                        { yAxis: avgStdDev, name: '平均偏科线', label: { formatter: '平均偏科' } }
                    ]
                }
            }
        ]
    };

    // 6. 第一次渲染：不包含 graphic 组件
    myChart.setOption(initialOption);

    // 7. 延迟 graphic 渲染
    setTimeout(() => {

        const graphicElements = [];
        //      使用 Z-Score 均值线
        const quadrantPositions = {
            '右上': [avgZScoreLine + (dynamicMaxX - avgZScoreLine) * 0.5, avgStdDev + (dynamicMaxY - avgStdDev) * 0.5],
            '左上': [dynamicMinX + (avgZScoreLine - dynamicMinX) * 0.5, avgStdDev + (dynamicMaxY - avgStdDev) * 0.5],
            '右下': [avgZScoreLine + (dynamicMaxX - avgZScoreLine) * 0.5, avgStdDev * 0.5],
            '左下': [dynamicMinX + (avgZScoreLine - dynamicMinX) * 0.5, avgStdDev * 0.5]
        };

        for (const key in quadrantPositions) {
            const [xCoord, yCoord] = quadrantPositions[key];

            // 确保坐标在 grid 范围内
            if (xCoord > dynamicMaxX || yCoord > dynamicMaxY || xCoord < dynamicMinX || yCoord < 0) continue;

            const [pixelX, pixelY] = myChart.convertToPixel('grid', [xCoord, yCoord]);

            graphicElements.push({
                type: 'text', left: pixelX, top: pixelY,
                style: {
                    text: quadrantLabels[key], fill: quadrantColors[key],
                    fontFamily: 'sans-serif', fontSize: 13, fontWeight: 'bold',
                    textAlign: 'center', textVerticalAlign: 'middle'
                },
                z: 100
            });
        }

        myChart.setOption({ graphic: graphicElements });

    }, 0);
}

/**
 * (修改后 - 支持打印考试名称) 10.18. 渲染“短板”学生表格
 */
function renderWeaknessTable(elementId, weaknessData) {
    const tableContainer = document.getElementById(elementId);
    if (!tableContainer) return;

    // 1. 创建列表，必须包含班级信息
    const studentWeaknessList = weaknessData.map(data => {
        if (!data.subjectDeviations || data.subjectDeviations.length === 0) {
            return {
                name: data.student.name,
                id: data.student.id,
                className: data.student.class, // 用于筛选
                avgZScore: data.avgZScore,
                weakestSubject: 'N/A',
                weakestDeviation: 0,
                weakestZScore: 'N/A'
            };
        }

        // 找到偏离度最小的科目
        const weakest = data.subjectDeviations.reduce((minSub, currentSub) => {
            return currentSub.deviation < minSub.deviation ? currentSub : minSub;
        }, data.subjectDeviations[0]);

        return {
            name: data.student.name,
            id: data.student.id,
            className: data.student.class, // 用于筛选
            avgZScore: data.avgZScore,
            weakestSubject: weakest.subject,
            weakestDeviation: weakest.deviation,
            weakestZScore: weakest.zScore
        };
    });

    // 2. 默认排序
    studentWeaknessList.sort((a, b) => a.weakestDeviation - b.weakestDeviation);

    // 3. 填充班级下拉框
    const classSelect = document.getElementById('weakness-class-filter');
    if (classSelect) {
        const uniqueClasses = [...new Set(studentWeaknessList.map(s => s.className))].sort();
        let opts = `<option value="ALL">-- 全部班级 --</option>`;
        uniqueClasses.forEach(c => {
            opts += `<option value="${c}">${c}</option>`;
        });
        classSelect.innerHTML = opts;
    }

    // 4. (核心) 渲染表格函数 (支持 搜索 + 班级筛选)
    const drawTable = () => {
        const searchTerm = document.getElementById('weakness-search').value.toLowerCase();
        const selectedClass = document.getElementById('weakness-class-filter').value;

        const filteredList = studentWeaknessList.filter(item => {
            // 搜索匹配
            const matchSearch = String(item.name).toLowerCase().includes(searchTerm) ||
                String(item.id).toLowerCase().includes(searchTerm);
            // 班级匹配
            const matchClass = (selectedClass === 'ALL') || (item.className === selectedClass);

            return matchSearch && matchClass;
        });

        let html = ``;
        if (filteredList.length === 0) {
            html = `<p style="text-align: center; padding: 20px; color: var(--text-muted);">未找到匹配的学生。</p>`;
        } else {
            html = `
                <table>
                    <thead>
                        <tr>
                            <th>班级</th>
                            <th>学生姓名</th>
                            <th>考号</th>
                            <th>最弱科目</th>
                            <th>最弱项偏离度</th>
                            <th>最弱项Z-Score</th>
                            <th>学生平均Z-Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredList.map(item => `
                            <tr data-id="${item.id}" style="cursor: pointer;">
                                <td>${item.className}</td>
                                <td><strong>${item.name}</strong></td>
                                <td>${item.id}</td>
                                <td><strong>${item.weakestSubject}</strong></td>
                                <td><strong class="${item.weakestDeviation < -0.5 ? 'regress' : ''}">${item.weakestDeviation.toFixed(2)}</strong></td>
                                <td>${item.weakestZScore !== 'N/A' ? item.weakestZScore.toFixed(2) : 'N/A'}</td>
                                <td>${item.avgZScore.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="margin-top:10px; font-size:0.85em; color:#666; text-align:right;">
                    共筛选出 ${filteredList.length} 人
                </div>
            `;
        }
        tableContainer.innerHTML = html;
    };

    // 5. 绑定事件
    const searchInput = document.getElementById('weakness-search');
    if (searchInput) searchInput.addEventListener('input', drawTable);
    if (classSelect) classSelect.addEventListener('change', drawTable);

    // 6. [修改] 绑定打印按钮事件 (获取考试名称)
    const printBtn = document.getElementById('weakness-print-btn');
    if (printBtn) {
        // 注意：这里添加了 async 关键字
        printBtn.addEventListener('click', async () => {
            const content = tableContainer.innerHTML;
            if (!content || content.includes('未找到匹配')) {
                alert('当前列表为空，无法打印。');
                return;
            }

            // [核心修改] 获取考试名称
            // 优先从 localforage 读取，如果失败则尝试 localStorage 或使用默认值
            let examName = "本次考试";
            try {
                const name = await localforage.getItem('G_MainFileName');
                if (name) examName = name;
                else {
                    // 降级尝试
                    examName = localStorage.getItem('G_MainFileName') || "本次考试";
                }
            } catch (e) {
                console.warn("无法读取考试名称", e);
            }

            // 获取当前筛选的班级名称以便展示
            const selectedClassVal = document.getElementById('weakness-class-filter').value;
            const subTitle = selectedClassVal === 'ALL' ? '全体学生' : selectedClassVal;

            // 构建打印页
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                <head>
                    <title>${examName} - 偏科诊断表</title>
                    <style>
                        body { font-family: "Segoe UI", Arial, sans-serif; padding: 30px; color: #333; }
                        h2 { text-align: center; margin-bottom: 5px; }
                        h4 { text-align: center; margin-top: 0; color: #666; font-weight: normal; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
                        th, td { border: 1px solid #333; padding: 8px; text-align: center; }
                        th { background-color: #f0f0f0; }
                        .regress { color: red; font-weight: bold; }
                        @media print {
                           .no-print { display: none; }
                        }
                    </style>
                </head>
                <body>
                    <h2>${examName} - 学生偏科诊断表</h2>
                    <h4>范围：${subTitle} | 生成时间：${new Date().toLocaleString()}</h4>
                    ${content}
                </body>
                </html>
            `);
            printWindow.document.close();
            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 500);
        });
    }

    // 7. 初始绘制
    drawTable();
}

/**
 * (    ) 10.19. 渲染单个学生的详细偏科表
 * (在 renderWeaknessTable 之后调用)
 */
function renderWeaknessDetail(containerElement, studentData) {
    const student = studentData.student;
    const deviations = [...studentData.subjectDeviations]; // 复制数组

    // 按偏离度升序排序 (最弱的在最前面)
    deviations.sort((a, b) => a.deviation - b.deviation);

    let html = `
        <h4>${student.name} (${student.id}) - 各科偏离度详情</h4>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
            <table>
                <thead>
                    <tr>
                        <th>科目</th>
                        <th>科目分数</th> <th>该科Z-Score</th>
                        <th>学生平均Z-Score</th>
                        <th>偏离度 (该科Z - 均Z)</th>
                    </tr>
                </thead>
                <tbody>
                    ${deviations.map(item => `
                        <tr>
                            <td><strong>${item.subject}</strong></td>
                            
                            <td style="font-weight:bold; color:#555;">
                                ${student.scores[item.subject] !== undefined ? student.scores[item.subject] : '-'}
                            </td>
                            
                            <td>${item.zScore.toFixed(2)}</td>
                            <td>${studentData.avgZScore.toFixed(2)}</td>
                            <td>
                                <strong class="${item.deviation < -0.5 ? 'regress' : (item.deviation > 0.5 ? 'progress' : '')}">
                                    ${item.deviation.toFixed(2)}
                                </strong>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    containerElement.innerHTML = html;
}


// ---------------------------------
// (    ) 10.21. 渲染不及格科目数条形图
// ---------------------------------
function renderFailureCountChart(elementId, failureCounts) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const labels = Object.keys(failureCounts).sort((a, b) => a - b);
    const data = labels.map(key => failureCounts[key]);

    const option = {
        title: {
            text: '不及格科目数量分布',
            subtext: 'X轴: 不及格(含缺考)的科目数, Y轴: 学生人数',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const p = params[0];
                return `<strong>${p.name} 科</strong><br/>学生人数: <strong>${p.value}</strong>人`;
            }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: labels,
            name: '不及格科目数'
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: data,
            barWidth: '60%',
            label: {
                show: true,
                position: 'top'
            },
            itemStyle: {
                color: (params) => {
                    const failCount = parseInt(params.name);
                    if (failCount === 0) return '#28a745'; // 全及格 (绿)
                    if (failCount === 1) return '#007bff'; // 1科 (蓝)
                    if (failCount <= 3) return '#ffc107'; // 2-3科 (黄)
                    return '#dc3545'; // 4科及以上 (红)
                }
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * [修改版] 渲染重叠直方图 (支持点击下钻查看名单)
 */
function renderOverlappingHistogram(elementId, currentData, compareData, subjectName, customBinSize, mode = 'raw') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 1. 内部辅助：从数据对象中提取分数数组
    const getScores = (list) => {
        return list.map(s => {
            if (mode === 'tscore') return s.tScores ? s.tScores[subjectName] : null;
            return (subjectName === 'totalScore') ? s.totalScore : s.scores[subjectName];
        });
    };

    const currentScores = getScores(currentData);
    const compareScores = getScores(compareData);

    const cleanCurrent = currentScores.filter(s => typeof s === 'number' && !isNaN(s));
    const cleanCompare = compareScores.filter(s => typeof s === 'number' && !isNaN(s));

    if (cleanCurrent.length === 0 && cleanCompare.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无数据可供显示。</p>`;
        return;
    }

    // 2. 计算统计指标 (保持不变)
    const calcStats = (scores) => {
        if (scores.length === 0) return { avg: 0, full: 100 };
        const sum = scores.reduce((a, b) => a + b, 0);
        const avg = sum / scores.length;
        let fullScore = 100;
        if (subjectName === 'totalScore') {
            fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
        } else {
            fullScore = G_SubjectConfigs[subjectName]?.full || 100;
        }
        return {
            avg: parseFloat(avg.toFixed(1)),
            full: fullScore
        };
    };
    const currStats = calcStats(cleanCurrent);
    const compStats = calcStats(cleanCompare);

    // 3. 确定分箱逻辑 (Binning)
    const allScores = [...cleanCurrent, ...cleanCompare];
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);

    let binSize;
    if (customBinSize && customBinSize > 0) {
        binSize = customBinSize;
    } else {
        if (mode === 'tscore') binSize = 5; // T分默认5分一段
        else {
            const fullScore = currStats.full;
            binSize = Math.max(5, Math.round(fullScore / 20));
        }
    }

    const startBin = Math.floor(min / binSize) * binSize;
    const endBinLimit = Math.ceil((max + 0.001) / binSize) * binSize;

    const labels = [];
    const binsCurrent = {};
    const binsCompare = {};

    for (let i = startBin; i < endBinLimit; i += binSize) {
        // 修正浮点数精度
        const rangeStart = parseFloat(i.toFixed(2));
        const rangeEnd = parseFloat((i + binSize).toFixed(2));
        const label = `${rangeStart}-${rangeEnd}`;
        labels.push(label);
        binsCurrent[label] = 0;
        binsCompare[label] = 0;
    }

    // 填充数据
    const fillBins = (scores, bins) => {
        scores.forEach(score => {
            if (score < startBin) return;
            let binIndex = Math.floor((score - startBin) / binSize);
            if (binIndex >= labels.length) binIndex = labels.length - 1;
            const label = labels[binIndex];
            if (label) bins[label]++;
        });
    };

    fillBins(cleanCurrent, binsCurrent);
    fillBins(cleanCompare, binsCompare);

    const dataCurrent = labels.map(label => binsCurrent[label]);
    const dataCompare = labels.map(label => binsCompare[label]);

    // 4. 配置图表
    let titleText = `${subjectName} 成绩分布对比`;
    let subTitleText = "";
    if (mode === 'tscore') {
        titleText += " (T分模式)";
        subTitleText = `本次T分均值: ${currStats.avg}  vs  上次T分均值: ${compStats.avg}`;
    } else {
        titleText += " (原始分模式)";
        subTitleText = `本次均分: ${currStats.avg}  vs  上次均分: ${compStats.avg}`;
    }

    const option = {
        title: {
            text: titleText,
            subtext: subTitleText,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' },
            subtextStyle: { fontSize: 12, color: '#666' }
        },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { data: ['本次成绩', '对比成绩'], top: 50 },
        grid: { left: '3%', right: '4%', bottom: '10%', top: 80, containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: mode === 'tscore' ? 'T分段' : '分数段',
            axisLabel: { interval: 'auto', rotate: 30 }
        },
        yAxis: { type: 'value', name: '人数' },
        series: [
            {
                name: '对比成绩',
                type: 'bar',
                data: dataCompare,
                itemStyle: { color: '#ccc' },
                markLine: {
                    symbol: 'none',
                    data: [{ xAxis: (compStats.avg - startBin) / binSize, lineStyle: { color: '#999', type: 'dashed' }, label: { formatter: `{c}`, position: 'start' } }],
                    silent: true
                }
            },
            {
                name: '本次成绩',
                type: 'bar',
                data: dataCurrent,
                itemStyle: { color: '#4285f4' },
                markLine: {
                    symbol: 'none',
                    data: [{ xAxis: (currStats.avg - startBin) / binSize, lineStyle: { color: '#4285f4', type: 'dashed' }, label: { formatter: `{c}`, position: 'end' } }],
                    silent: true
                }
            }
        ]
    };
    myChart.setOption(option);

    // ============================================================
    //            绑定点击事件，显示名单弹窗
    // ============================================================
    myChart.on('click', function (params) {
        const label = params.name; // 例如 "75-80"
        const seriesName = params.seriesName; // "本次成绩" 或 "对比成绩"

        if (!label || !label.includes('-')) return;

        const [minStr, maxStr] = label.split('-');
        const minVal = parseFloat(minStr);
        const maxVal = parseFloat(maxStr);

        // 确定数据源 (本次还是上次)
        const isCurrent = (seriesName === '本次成绩');
        const sourceData = isCurrent ? currentData : compareData;

        // 筛选学生逻辑
        const drilledStudents = sourceData.filter(s => {
            let val;
            if (mode === 'tscore') {
                val = s.tScores ? s.tScores[subjectName] : null;
            } else {
                val = (subjectName === 'totalScore') ? s.totalScore : s.scores[subjectName];
            }

            if (typeof val !== 'number' || isNaN(val)) return false;

            // 范围判断 [min, max)
            // 为了包含最后一个区间的最大值，如果点击的是最后一个柱子，则改为闭区间
            const isLastBin = (label === labels[labels.length - 1]);
            if (isLastBin) {
                return val >= minVal && val <= maxVal + 0.001;
            } else {
                return val >= minVal && val < maxVal;
            }
        });

        // 调用通用弹窗显示名单
        const typeText = mode === 'tscore' ? 'T分' : '分';
        const title = `${subjectName} ${typeText}段 [${label}] 学生名单 (${seriesName})`;

        // 注意：showDrillDownModal 默认显示的是原始分，这正好方便老师核对
        showDrillDownModal(title, drilledStudents, subjectName);
    });
}

/**
 * (    ) 10.24. 渲染临界生模块 - 单个学生科目详情
 *       - 不及格科目和分数均标红
 */
function renderBoundaryStudentDetail(containerElement, student) {

    // (从 G_DynamicSubjectList 构建科目数据)
    const subjectData = G_DynamicSubjectList.map(subject => {

        const score = student.scores[subject];
        const config = G_SubjectConfigs[subject];
        let scoreClass = '';

        if (config && typeof score === 'number' && score < config.pass) {
            scoreClass = 'regress'; //
        }

        return {
            name: subject,
            score: score || 'N/A',
            classRank: (student.classRanks && student.classRanks[subject]) ? student.classRanks[subject] : 'N/A',
            gradeRank: (student.gradeRanks && student.gradeRanks[subject]) ? student.gradeRanks[subject] : 'N/A',
            scoreClass: scoreClass
        };
    });

    let html = `
        <h4>${student.name} (${student.id}) - 全科成绩详情</h4>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
            <table>
                <thead>
                    <tr>
                        <th>科目</th>
                        <th>得分</th>
                        <th>班级科目排名</th>
                        <th>年级科目排名</th>
                    </tr>
                </thead>
                <tbody>
                    ${subjectData.map(item => `
                        <tr>
                            <td class="${item.scoreClass}"><strong>${item.name}</strong></td>
                            <td class="${item.scoreClass}"><strong>${item.score}</strong></td>
                            <td>${item.classRank}</td>
                            <td>${item.gradeRank}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    containerElement.innerHTML = html;
}

/**
 * (    ) 10.12. 渲染分层筛选 - 班级构成饼图
 */
function renderGroupClassPie(elementId, filteredStudents) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 统计班级
    const classCounts = {};
    filteredStudents.forEach(student => {
        classCounts[student.class] = (classCounts[student.class] || 0) + 1;
    });

    // 2. 转换为 ECharts 数据
    const pieData = Object.keys(classCounts).map(className => {
        return {
            value: classCounts[className],
            name: className
        };
    }).sort((a, b) => b.value - a.value); // (按人数降序)

    const option = {
        title: {
            text: '筛选群体的班级构成',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c}人 ({d}%)'
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            top: 'middle',
            data: pieData.map(d => d.name).slice(0, 10) // (最多显示10个图例)
        },
        series: [{
            name: '班级',
            type: 'pie',
            radius: ['40%', '70%'], // (空心圆)
            center: ['65%', '55%'], // (饼图靠右, 为图例腾空间)
            data: pieData,
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            },
            label: {
                show: false,
                position: 'center'
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
}
/**
 * (    ) 10.13. 渲染分层筛选 - 群体能力雷达图
 * (对比 "筛选群体" vs "全体平均" 的得分率)
 * @param {Object} filteredStudents - 筛选出的学生
 * @param {Object} totalStats - G_Statistics (全体统计)
 */
function renderGroupRadarChart(elementId, filteredStudents, totalStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. (关键) 重  计算这个 "筛选群体" 的统计数据
    //    复用 calculateAllStatistics 函数
    const groupStats = calculateAllStatistics(filteredStudents);

    // 2. 准备雷达图指示器 (max 设为 1, 因为我们用难度/得分率)
    const indicators = G_DynamicSubjectList.map(subject => {
        // (动态获取最大值, 0.8 左右是比较好的最大值)
        const max = Math.max(
            totalStats[subject]?.difficulty || 0,
            groupStats[subject]?.difficulty || 0
        );
        return { name: subject, max: Math.max(1.0, Math.ceil(max * 10) / 10) };
    });

    // 3. (    ) 获取 "筛选群体" 的得分率 (即难度)
    const groupData = G_DynamicSubjectList.map(subject => {
        return groupStats[subject]?.difficulty || 0;
    });

    // 4. (    ) 获取 "全体平均" 的得分率 (即难度)
    const totalData = G_DynamicSubjectList.map(subject => {
        return totalStats[subject]?.difficulty || 0;
    });

    const option = {
        title: {
            text: '群体能力 vs 全体平均',
            subtext: '(指标: 得分率/难度)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: { trigger: 'item' },
        legend: {
            data: ['筛选群体', '全体平均'],
            bottom: 10
        },
        radar: {
            indicator: indicators,
            radius: '65%',
            splitArea: {
                areaStyle: {
                    color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
                }
            }
        },
        series: [{
            name: '群体 vs 全体',
            type: 'radar',
            data: [
                {
                    value: groupData,
                    name: '筛选群体',
                    areaStyle: { opacity: 0.4, color: '#28a745' },
                    itemStyle: { color: '#28a745' },
                    lineStyle: { color: '#28a745' }
                },
                {
                    value: totalData,
                    name: '全体平均',
                    areaStyle: { opacity: 0.2, color: '#007bff' },
                    itemStyle: { color: '#007bff' },
                    lineStyle: { color: '#007bff' }
                }
            ]
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (    ) 10.14. [辅助函数] 计算皮尔逊相关系数
 * @param {Array<Number>} xScores - 数组 X
 * @param {Array<Number>} yScores - 数组 Y
 * @returns {Number} - 相关系数 ( -1 到 1 )
 */
function calculateCorrelation(xScores, yScores) {
    if (!xScores || !yScores || xScores.length !== yScores.length || xScores.length < 2) {
        return 0; // 无法计算
    }

    const n = xScores.length;
    const mean = (arr) => arr.reduce((sum, val) => sum + val, 0) / n;

    const meanX = mean(xScores);
    const meanY = mean(yScores);

    const stdDev = (arr, meanVal) => Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / n);

    const stdDevX = stdDev(xScores, meanX);
    const stdDevY = stdDev(yScores, meanY);

    if (stdDevX === 0 || stdDevY === 0) {
        return 0; // (没有方差，无法计算)
    }

    let covariance = 0;
    for (let i = 0; i < n; i++) {
        covariance += (xScores[i] - meanX) * (yScores[i] - meanY);
    }

    const correlationCoefficient = covariance / (n * stdDevX * stdDevY);
    return correlationCoefficient;
}

/**
 * (    ) 10.20. 渲染单科A/B/C/D等级构成饼图
 */
function renderSingleSubjectPie(elementId, subjectStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    //    从 stats 中获取 A, B, C, D 的比率
    // A = 优秀率
    // B = 良好率
    // C = C率 (及格但未良好)
    // D = 不及格率
    const pieData = [
        { value: subjectStats.excellentRate || 0, name: 'A (优秀)' },
        { value: subjectStats.goodRate || 0, name: 'B (良好)' },
        { value: subjectStats.cRate || 0, name: 'C (及格)' },
        { value: subjectStats.failRate || 0, name: 'D (不及格)' }
    ];

    const option = {
        title: {
            text: '等级构成',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c}%'
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            top: 'middle'
        },
        series: [{
            name: '等级',
            type: 'pie',
            radius: ['40%', '70%'], // (空心圆)
            center: ['65%', '55%'], // (饼图靠右, 为图例腾空间)
            data: pieData,
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            },
            label: {
                show: true,
                formatter: '{d}%', // (在饼图上显示百分比)
                position: 'inside',
                color: '#fff'
            },
            //    (    ) 颜色映射
            color: [
                '#28a745', // A (绿)
                '#007bff', // B (蓝)
                '#ffc107', // C (黄)
                '#dc3545'  // D (红)
            ]
        }]
    };
    echartsInstances[elementId].setOption(option);
}

// ---------------------------------
// (    ) 10.21. 渲染不及格科目数条形图
// ---------------------------------
//      接收 failureData (对象) 而不是 failureCounts (数字)
function renderFailureCountChart(elementId, failureData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    //      从 failureData 计算 labels 和 data
    const labels = Object.keys(failureData).sort((a, b) => a - b); // ['0', '1', '2']
    const data = labels.map(key => {
        const students = failureData[key] || [];
        return {
            value: students.length, //      value 是数组长度
            names: students.map(s => s.name) //    (    ) 存储姓名用于 tooltip
        };
    });
    const categoryLabels = labels.map(l => `${l} 科`); // ['0 科', '1 科', '2 科']


    const option = {
        title: {
            text: '不及格科目数量分布',
            subtext: 'X轴: 不及格(含缺考)的科目数, Y轴: 学生人数',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                //      Tooltip 显示姓名
                const p = params[0];
                const names = p.data.names || [];
                let namesHtml = names.slice(0, 10).join('<br/>');
                if (names.length > 10) {
                    namesHtml += `<br/>... (及另外 ${names.length - 10} 人)`;
                }

                return `<strong>${p.name}</strong><br/>` +
                    `学生人数: <strong>${p.value}</strong>人` +
                    `<hr style="margin: 5px 0; border-color: #eee;"/>` +
                    `${namesHtml}`;
            }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: categoryLabels, //    (修改)
            name: '不及格科目数'
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: data, //    (修改)
            barWidth: '60%',
            label: {
                show: true,
                position: 'top'
            },
            itemStyle: {
                color: (params) => {
                    //      解析 '0 科'
                    const failCount = parseInt(params.name.split(' ')[0]);
                    if (failCount === 0) return '#28a745'; // 全及格 (绿)
                    if (failCount === 1) return '#007bff'; // 1科 (蓝)
                    if (failCount <= 3) return '#ffc107'; // 2-3科 (黄)
                    return '#dc3545'; // 4科及以上 (红)
                }
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
    return echartsInstances[elementId]; //    (    ) 返回实例
}

/**
 * 渲染排名流动桑基图
 */
function renderRankingSankey(elementId, mergedData, rankTiers, getRankCategory, currentFilter, subject = 'totalScore') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return null;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    if (mergedData.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无匹配的学生数据。</p>`;
        return null;
    }

    //    1. 定义颜色盘 (对应 rankTiers 的顺序)
    // 顺序：Top 10% (蓝), 10-30% (橙), 30-60% (绿), Bottom 40% (红/粉)
    const tierColors = ['#5470c6', '#fac858', '#91cc75', '#ee6666'];

    // 2. ECharts Nodes
    const nodes = [];

    //    修复：在生成节点时分配颜色
    rankTiers.forEach((tier, index) => {
        const color = tierColors[index % tierColors.length]; // 按顺序取色
        nodes.push({
            name: `上次: ${tier.name}`,
            itemStyle: { color: color } // 设定颜色
        });
    });

    rankTiers.forEach((tier, index) => {
        const color = tierColors[index % tierColors.length];
        nodes.push({
            name: `本次: ${tier.name}`,
            itemStyle: { color: color } // 设定颜色
        });
    });

    // 3. ECharts Links
    const linksMap = {};

    mergedData.forEach(student => {
        const useGradeRank = (currentFilter === 'ALL');
        let oldRank, newRank;

        if (subject === 'totalScore') {
            oldRank = useGradeRank ? (student.oldGradeRank || 0) : student.oldRank;
            newRank = useGradeRank ? (student.gradeRank || 0) : student.rank;
        } else {
            const oldRanksObj = useGradeRank ? (student.oldGradeRanks || {}) : (student.oldClassRanks || {});
            const newRanksObj = useGradeRank ? (student.gradeRanks || {}) : (student.classRanks || {});
            oldRank = oldRanksObj[subject] || 0;
            newRank = newRanksObj[subject] || 0;
        }

        if (oldRank > 0 && newRank > 0) {
            const source = `上次: ${getRankCategory(oldRank)}`;
            const target = `本次: ${getRankCategory(newRank)}`;
            const key = `${source} -> ${target}`;
            linksMap[key] = (linksMap[key] || 0) + 1;
        }
    });

    const links = Object.keys(linksMap).map(key => {
        const [source, target] = key.split(' -> ');
        return {
            source: source,
            target: target,
            value: linksMap[key]
        };
    });

    const titleText = (subject === 'totalScore') ? '总分排名' : `${subject}排名`;

    const option = {
        title: {
            text: `${titleText}分层流动图`,
            subtext: `基于两次${subject === 'totalScore' ? '总分' : subject}均有效的学生`,
            left: 'center'
        },
        tooltip: {
            trigger: 'item',
            triggerOn: 'mousemove',
            formatter: (params) => {
                if (params.dataType === 'link') {
                    return `${params.data.source} → ${params.data.target}: ${params.data.value} 人`;
                }
                if (params.dataType === 'node') {
                    return `${params.name}: ${params.value} 人`;
                }
                return '';
            }
        },
        series: [{
            type: 'sankey',
            data: nodes,
            links: links,
            emphasis: { focus: 'adjacency' },
            nodeAlign: 'justify',
            layoutIterations: 32,
            lineStyle: {
                color: 'gradient', //    恢复渐变色 (依赖 source 和 target 的颜色)
                curveness: 0.5,
                opacity: 0.4
            },
            label: {
                fontSize: 11,
                color: '#333',
                formatter: '{b}'
            },
            levels: [
                { depth: 0, itemStyle: { opacity: 1 }, lineStyle: { color: 'source', opacity: 0.3 } },
                { depth: 1, itemStyle: { opacity: 1 }, lineStyle: { color: 'source', opacity: 0.3 } }
            ]
        }]
    };

    echartsInstances[elementId].setOption(option, { notMerge: true });

    return echartsInstances[elementId];
}


/**
 * (    ) 11.1. 计算所有班级的统计数据 (用于班级对比)
 * @param {string} metric - 'average', 'passRate', 'stdDev'
 * @param {string} subject - 'totalScore', '语文', ...
 * @returns {Array} - e.g., [{ name: '高一1班', value: 85.5 }, ...]
 */
function calculateClassComparison(metric, subject) {
    if (!G_StudentsData || G_StudentsData.length === 0) return [];

    const classes = [...new Set(G_StudentsData.map(s => s.class))].sort();
    const classData = [];

    for (const className of classes) {
        // 1. 筛选出该班的学生
        const classStudents = G_StudentsData.filter(s => s.class === className);

        // 2. 为该班计算统计数据 (使用全局科目配置)
        const classStats = calculateAllStatistics(classStudents);

        // 3. 提取所需的特定指标
        let value = 0;
        if (classStats[subject] && classStats[subject][metric] !== undefined) {
            value = classStats[subject][metric];
        }

        classData.push({
            name: className.replace('高一年级', ''), // 简化班级名称 (可自定义)
            value: value
        });
    }



    return classData;
}

/**
 * 10.25. (ECharts) 渲染多次考试曲线图
 */
function renderMultiExamLineChart(elementId, title, examNames, seriesData, yAxisInverse) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const option = {
        title: {
            text: title,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' }
        },
        legend: {
            top: 30,
            type: 'scroll' // (如果科目太多)
        },
        grid: {
            left: '10%',
            right: '10%',
            bottom: '15%',
            top: 70
        },
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: examNames,
            axisLabel: {
                rotate: 15,
                interval: 0 // (强制显示所有X轴标签)
            }
        },
        yAxis: {
            type: 'value',
            inverse: yAxisInverse, //    (排名图需要反转)
            axisPointer: {
                snap: true
            }
        },
        dataZoom: [ // (允许缩放)
            {
                type: 'inside',
                xAxisIndex: [0]
            },
            {
                type: 'slider',
                xAxisIndex: [0],
                bottom: 10,
                height: 20
            }
        ],
        series: seriesData
    };

    echartsInstances[elementId].setOption(option);
}

/**
 * [修改版] 11. 启动时从 IndexedDB 加载数据
 * 保留了您原有的所有解析逻辑和容错处理
 */
async function loadDataFromStorage() {
    console.log("🚀 系统启动：正在连接 IndexedDB 加载数据...");

    try {
        // 1. [修改] 并行读取数据 (    了 ItemAnalysisData 等3个Key)
        const [
            storedData,
            storedCompareData,
            storedConfigs,
            storedMainFile,
            storedCompareFile,
            storedItemData,      // [    ]
            storedItemConfig,    // [    ]
            storedItemFile       // [    ]
        ] = await Promise.all([
            localforage.getItem('G_StudentsData'),
            localforage.getItem('G_CompareData'),
            localforage.getItem('G_SubjectConfigs'),
            localforage.getItem('G_MainFileName'),
            localforage.getItem('G_CompareFileName'),
            localforage.getItem('G_ItemAnalysisData'),    // [    ]
            localforage.getItem('G_ItemAnalysisConfig'),  // [    ]
            localforage.getItem('G_ItemAnalysisFileName') // [    ]
        ]);

        // 2. [保留原有逻辑] 如果没有“本次成绩”，则什么也不做
        if (!storedData) {
            console.log("📭 本地存储为空，等待用户导入...");
            initializeSubjectConfigs();
            // 如果这里直接 return，小题数据可能也加载不到了，但考虑到没有主数据系统无法运行，保持您原有的 return 逻辑是合理的
            return;
        }

        // 3. [保留原有逻辑] 检查数据类型 (兼容性修复)
        if (typeof storedData === 'string') {
            console.log("⚠️ 检测到字符串格式的本次成绩，正在解析...");
            G_StudentsData = JSON.parse(storedData);
        } else {
            G_StudentsData = storedData;
        }

        // 4. [保留原有逻辑] 检查对比数据
        if (storedCompareData) {
            if (typeof storedCompareData === 'string') {
                console.log("⚠️ 检测到字符串格式的对比成绩，正在解析...");
                G_CompareData = JSON.parse(storedCompareData);
            } else {
                G_CompareData = storedCompareData;
            }
        }

        console.log(`✅ 成功加载本次成绩：${G_StudentsData.length} 条记录`);

        // 5. [保留原有逻辑] 重建 G_DynamicSubjectList
        if (G_StudentsData.length > 0) {
            const allSubjects = new Set();
            G_StudentsData.forEach(student => {
                if (student.scores) {
                    Object.keys(student.scores).forEach(subject => allSubjects.add(subject));
                }
            });
            if (allSubjects.size > 0) {
                G_DynamicSubjectList = Array.from(allSubjects);
            }
        }

        // 6. [保留原有逻辑] 加载配置
        if (storedConfigs) {
            G_SubjectConfigs = storedConfigs;
        } else {
            initializeSubjectConfigs();
        }

        // 7. [保留原有逻辑] 健壮性检查：确保所有科目都有配置
        G_DynamicSubjectList.forEach(subject => {
            if (!G_SubjectConfigs[subject]) {
                const isY_S_W = ['语文', '数学', '英语'].includes(subject);
                G_SubjectConfigs[subject] = {
                    full: isY_S_W ? 150 : 100,
                    excel: isY_S_W ? 120 : 85,
                    good: isY_S_W ? (isY_S_W ? 105 : 75) : (100 + 60) / 2,
                    pass: isY_S_W ? 90 : 60,
                };
            }
        });

        // ============================================================
        //            预加载“学科小题分析”数据
        // ============================================================
        if (storedItemData) {
            G_ItemAnalysisData = storedItemData;
            console.log(`✅ 成功预加载小题数据: ${Object.keys(storedItemData).length} 科`);
        }
        if (storedItemConfig) {
            G_ItemAnalysisConfig = storedItemConfig;
        }
        // 顺便更  一下模块十三那边的状态文字 (如果 DOM 存在)
        const itemStatusLabel = document.getElementById('item-analysis-status');
        if (itemStatusLabel && storedItemFile) {
            itemStatusLabel.innerText = `✅ 已加载: ${storedItemFile}`;
        }
        // ============================================================

        // 8. [保留原有逻辑] UI 更  
        populateClassFilter(G_StudentsData);
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        const compareBtnEl = document.getElementById('import-compare-btn');
        if (compareBtnEl) compareBtnEl.classList.remove('disabled');

        navLinks.forEach(l => l.classList.remove('disabled'));
        if (classFilterContainer) classFilterContainer.style.display = 'block';
        if (classFilterHr) classFilterHr.style.display = 'block';

        if (storedMainFile) {
            const mainBtn = document.getElementById('import-main-btn');
            if (mainBtn) mainBtn.innerHTML = `✅ ${storedMainFile} (已加载)`;
        }
        if (storedCompareFile && compareBtnEl) {
            compareBtnEl.innerHTML = `✅ ${storedCompareFile} (已加载)`;
        }

        // 9. [保留原有逻辑] 运行分析
        runAnalysisAndRender();

    } catch (err) {
        // [保留原有逻辑] 错误处理
        console.error("❌ IndexedDB 读取严重失败:", err);
        alert("读取缓存数据出错。如果问题持续，请点击左下角的“清除所有导入数据”按钮重置系统。");
    }
}

/**
 * (    ) 11.2.   渲染“多次考试”的UI列表
 */
function renderMultiExamList(multiExamData) {
    const listContainer = document.getElementById('multi-exam-list');
    if (!listContainer) return;

    if (!multiExamData || multiExamData.length === 0) {
        listContainer.innerHTML = `<li class="multi-exam-item-empty">暂无数据，请点击“添加  成绩”上传。</li>`;
        return;
    }

    listContainer.innerHTML = multiExamData.map((item, index) => {
        return `
            <li class="multi-exam-item ${item.isHidden ? 'is-hidden' : ''}" data-id="${item.id}">
                <span class="multi-exam-index">${index + 1}.</span>
                <input type="text" value="${item.label}" data-role="label" class="multi-exam-label" title="点击可重命名: ${item.originalName}">
                    <div class="multi-exam-buttons">
                    <button data-role="up" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button data-role="down" ${index === multiExamData.length - 1 ? 'disabled' : ''}>▼</button>
                    
                    <button data-role="toggle-hide" class="hide-btn" title="${item.isHidden ? '点击设为可见' : '点击设为隐藏'}">
                        ${item.isHidden ? '🚫' : '👁️'}
                    </button>
                    
                    <button data-role="delete" class="delete-btn">×</button>
                </div>
            </li>
        `;
    }).join('');
}

/**
 * [修改版] 保存考试数据到当前选中的列表
 */
async function saveMultiExamData(examArray) {
    // 1. 读取所有集合
    const collections = await getCollections();

    // 2. 更  当前集合的 exams
    if (collections[G_CurrentCollectionId]) {
        collections[G_CurrentCollectionId].exams = examArray;

        // 3. 保存回 LocalStorage
        await saveCollections(collections);

        // 4. 顺便更  一下下拉框显示的考试数量
        await renderCollectionSelect();
    }
}

/**
 * [修改版] 从当前选中的列表中加载考试数据
 */
async function loadMultiExamData() {
    // 1. 确保数据结构存在
    await ensureCollectionsExist();

    // 2. 读取所有集合
    const collections = await getCollections();

    // 3. 返回当前集合的 exams 数组
    // (  加容错：如果当前ID不对，默认返回空数组)
    if (collections[G_CurrentCollectionId]) {
        // 同样做一次旧数据兼容处理 (isHidden)
        return collections[G_CurrentCollectionId].exams.map(item => ({
            ...item,
            isHidden: item.isHidden || false
        }));
    } else {
        return [];
    }
}


/**
 *   11.5. 初始化“多次考试分析”的学生搜索框
 *    修复版    解决 loadMultiExamData 返回 Promise 导致的 .filter 报错
 */
function initializeStudentSearch(multiExamData) {
    const searchInput = document.getElementById('multi-student-search');
    const resultsContainer = document.getElementById('multi-student-search-results');
    const reportContainer = document.getElementById('multi-student-report');

    if (!searchInput) return;

    // (计算所有学生列表 - 不变)
    const allStudentsMap = new Map();
    multiExamData.filter(e => !e.isHidden).forEach(exam => {
        exam.students.forEach(student => {
            if (!allStudentsMap.has(student.id)) {
                allStudentsMap.set(student.id, student.name);
            }
        });
    });
    const allStudentsList = Array.from(allStudentsMap, ([id, name]) => ({ id, name }));

    // (搜索框 input 事件 - 不变)
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length < 1) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }
        const filteredStudents = allStudentsList.filter(s => {
            return String(s.name).toLowerCase().includes(searchTerm) ||
                String(s.id).toLowerCase().includes(searchTerm);
        }).slice(0, 50);

        if (filteredStudents.length === 0) {
            resultsContainer.innerHTML = '<div class="result-item">-- 未找到 --</div>';
        } else {
            resultsContainer.innerHTML = filteredStudents.map(s => {
                return `<div class="result-item" data-id="${s.id}">
                    <strong>${s.name}</strong> (${s.id})
                </div>`;
            }).join('');
        }
        resultsContainer.style.display = 'block';
    });

    // (点击搜索结果 事件 -    修改：  加 async/await)
    resultsContainer.addEventListener('click', async (e) => {
        const item = e.target.closest('.result-item');
        if (item && item.dataset.id) {
            const studentId = item.dataset.id;
            const studentName = item.querySelector('strong').innerText;

            searchInput.value = `${studentName} (${studentId})`;
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';

            document.getElementById('multi-student-name-title').innerText = `${studentName} 的成绩曲线`;
            reportContainer.style.display = 'block';

            // 存储当前学生ID
            reportContainer.dataset.studentId = studentId;

            // [修复点] 等待数据加载
            const currentData = await loadMultiExamData();
            drawMultiExamChartsAndTable(studentId, currentData, true);
        }
    });

    document.addEventListener('click', (e) => {
        if (searchInput && !searchInput.contains(e.target) && resultsContainer && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    // 绑定筛选器事件
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    const selectAllBtn = document.getElementById('multi-subject-all');
    const selectNoneBtn = document.getElementById('multi-subject-none');

    // (辅助函数：重绘图表 -    修改：  加 async/await)
    const redrawCharts = async () => {
        const currentStudentId = reportContainer.dataset.studentId;
        if (currentStudentId) {
            // [修复点] 等待数据加载
            const currentData = await loadMultiExamData();
            drawMultiExamChartsAndTable(currentStudentId, currentData, false);
        }
    };

    if (checkboxContainer) {
        checkboxContainer.addEventListener('change', redrawCharts);
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            redrawCharts();
        });
    }

    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', () => {
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            redrawCharts();
        });
    }
}

/**
 *   11.6. (核心) 绘制多次考试的图表和表格
 */
function drawMultiExamChartsAndTable(studentId, multiExamData, forceRepopulateCheckboxes = false) {

    // 1. 过滤与准备数据
    const visibleExamData = multiExamData.filter(e => !e.isHidden);
    const examNames = visibleExamData.map(e => e.label);

    const rankData = { classRank: [], gradeRank: [] };
    const subjectData = {};
    const subjectRankData = {};

    const allSubjects = new Set();
    visibleExamData.forEach(exam => {
        exam.students.forEach(s => {
            if (s.scores) Object.keys(s.scores).forEach(subject => allSubjects.add(subject));
        });
    });

    const dynamicSubjects = Array.from(allSubjects);
    dynamicSubjects.forEach(subject => {
        subjectData[subject] = [];
        subjectRankData[subject] = { classRank: [], gradeRank: [] };
    });

    let currentStudentName = "学生";
    let currentStudentClass = "";

    // 2. 填充数据 (获取当前学生的数据)
    visibleExamData.forEach(exam => {
        const student = exam.students.find(s => String(s.id) === String(studentId));
        if (student) {
            if (currentStudentName === "学生") {
                currentStudentName = student.name;
                currentStudentClass = student.class;
            }

            rankData.classRank.push(student.rank || null);
            rankData.gradeRank.push(student.gradeRank || null);

            dynamicSubjects.forEach(subject => {
                const rawScore = student.scores[subject];
                subjectData[subject].push((rawScore !== null && rawScore !== undefined) ? rawScore : null);

                let classRank = null;
                let gradeRank = null;

                if (typeof rawScore === 'number' && !isNaN(rawScore)) {
                    // [修复] 删除之前报错的 validClassRank 行，直接使用下方逻辑
                    classRank = student.classRanks ? student.classRanks[subject] : null;
                    gradeRank = student.gradeRanks ? student.gradeRanks[subject] : null;
                }

                subjectRankData[subject].classRank.push(classRank);
                subjectRankData[subject].gradeRank.push(gradeRank);
            });
        } else {
            // 缺考填空
            rankData.classRank.push(null);
            rankData.gradeRank.push(null);
            dynamicSubjects.forEach(subject => {
                subjectData[subject].push(null);
                subjectRankData[subject].classRank.push(null);
                subjectRankData[subject].gradeRank.push(null);
            });
        }
    });

    // 3. [图表1 数据]
    const scoreSeries = [];
    dynamicSubjects.forEach(subject => {
        scoreSeries.push({ name: subject, type: 'line', data: subjectData[subject], smooth: true, connectNulls: true });
    });

    // 4. 复选框逻辑
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    if (checkboxContainer && forceRepopulateCheckboxes) {
        checkboxContainer.innerHTML = dynamicSubjects.map(subject => `
            <div><input type="checkbox" id="multi-cb-${subject}" value="${subject}" checked><label for="multi-cb-${subject}">${subject}</label></div>
        `).join('');
    }
    const checkedSubjects = new Set();
    if (checkboxContainer) {
        checkboxContainer.querySelectorAll('input:checked').forEach(cb => checkedSubjects.add(cb.value));
    }
    const filteredScoreSeries = scoreSeries.filter(series => checkedSubjects.has(series.name));

    // 5. [图表2 数据]
    const totalRankSeries = [];
    totalRankSeries.push({ name: '班级排名 (总)', type: 'line', data: rankData.classRank, smooth: true, connectNulls: true });
    totalRankSeries.push({ name: '年级排名 (总)', type: 'line', data: rankData.gradeRank, smooth: true, connectNulls: true });

    // 6. 渲染 图表
    if (typeof renderMultiExamLineChart === 'function') {
        renderMultiExamLineChart('multi-exam-score-chart', '', examNames, filteredScoreSeries, false);
        renderMultiExamLineChart('multi-exam-rank-chart', '', examNames, totalRankSeries, true);
    }

    const rankTypeSelect = document.getElementById('multi-rank-type-select');
    const rankType = rankTypeSelect ? rankTypeSelect.value : 'both';

    if (typeof renderSubjectRankChart === 'function') {
        renderSubjectRankChart('multi-exam-subject-rank-chart', examNames, visibleExamData, studentId, checkedSubjects, rankType);
    }

    // 8. 绘制表格 (含打印按钮)
    const tableContainer = document.getElementById('multi-student-table-container');
    if (!tableContainer) return;

    const safeVal = (v) => (v !== null && v !== undefined) ? v : '-';

    // 构建表格 HTML 的辅助函数
    const generateSingleTableHTML = (sName, sClass, sId, sRankData, sSubData, sSubRankData) => {
        return `
            <div class="print-page-wrapper" style="page-break-after: always; padding: 20px;">
                <div style="text-align:center; margin-bottom:20px;">
                    <h2 style="margin:0;">${sName} - 历次考试成绩详情</h2>
                    <p style="margin:5px 0; color:#666;">班级: ${sClass} | 考号: ${sId}</p>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: center;">
                    <thead>
                        <tr style="background-color: #f0f0f0;">
                            <th style="border: 1px solid #999; padding: 8px; min-width: 120px;">考试名称</th>
                            <th style="border: 1px solid #999; padding: 8px;">班级排名 (总)</th>
                            <th style="border: 1px solid #999; padding: 8px;">年级排名 (总)</th>
                            ${dynamicSubjects.map(s => `<th style="border: 1px solid #999; padding: 8px;">${s}<br>(分数)</th>`).join('')}
                            ${dynamicSubjects.map(s => `<th style="border: 1px solid #999; padding: 8px;">${s}<br>(班排)</th>`).join('')}
                            ${dynamicSubjects.map(s => `<th style="border: 1px solid #999; padding: 8px;">${s}<br>(年排)</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${examNames.map((examName, index) => `
                            <tr>
                                <td style="border: 1px solid #999; padding: 8px; font-weight: bold;">${examName}</td>
                                <td style="border: 1px solid #999; padding: 8px;">${safeVal(sRankData.classRank[index])}</td>
                                <td style="border: 1px solid #999; padding: 8px;">${safeVal(sRankData.gradeRank[index])}</td>
                                ${dynamicSubjects.map(subject => `<td style="border: 1px solid #999; padding: 8px;">${safeVal(sSubData[subject][index])}</td>`).join('')}
                                ${dynamicSubjects.map(subject => `<td style="border: 1px solid #999; padding: 8px;">${safeVal(sSubRankData[subject].classRank[index])}</td>`).join('')}
                                ${dynamicSubjects.map(subject => `<td style="border: 1px solid #999; padding: 8px;">${safeVal(sSubRankData[subject].gradeRank[index])}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div style="margin-top: 20px; text-align: right; font-size: 10px; color: #999;">
                    生成时间: ${new Date().toLocaleString()}
                </div>
            </div>
        `;
    };

    // 生成当前学生的 HTML (用于显示)
    const currentStudentHtml = generateSingleTableHTML(currentStudentName, currentStudentClass, studentId, rankData, subjectData, subjectRankData);

    // 渲染到页面
    let interfaceHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-top: 20px; border-top: 1px solid var(--border-color); flex-wrap: wrap; gap: 10px;">
            <h4 style="margin: 0;">成绩详情表</h4>
            <div>
                <button id="multi-print-table-btn" class="sidebar-button" style="font-size: 0.9em; padding: 6px 12px; background-color: var(--color-gray);">
                    🖨️ 打印当前
                </button>
                <button id="multi-batch-print-btn" class="sidebar-button" style="font-size: 0.9em; padding: 6px 12px; background-color: var(--color-blue); margin-left: 10px;">
                    📑 批量打印 (全班/每人一页)
                </button>
            </div>
        </div>
        <div class="table-container" id="multi-print-table-content" style="max-height: 400px;">
            ${currentStudentHtml.replace(/<div class="print-page-wrapper".*?>|<\/div>$/g, '')} </div>
    `;
    tableContainer.innerHTML = interfaceHtml;

    // 绑定事件：打印当前
    const printBtn = document.getElementById('multi-print-table-btn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            if (typeof startMultiTablePrintJob === 'function') {
                startMultiTablePrintJob(currentStudentName, currentStudentHtml);
            } else {
                console.error("startMultiTablePrintJob 未定义");
            }
        });
    }

    // 绑定事件：批量打印
    const batchPrintBtn = document.getElementById('multi-batch-print-btn');
    if (batchPrintBtn) {
        batchPrintBtn.addEventListener('click', () => {
            if (!currentStudentClass) {
                alert("无法识别当前学生的班级，无法进行批量打印。");
                return;
            }

            if (!confirm(`即将生成 "${currentStudentClass}" 所有学生的成绩单。\n\n每位学生将占据一页，是否继续？`)) return;

            // 1. 找出同班同学
            const classStudentsMap = new Map(); // 用 Map 去重
            visibleExamData.forEach(exam => {
                exam.students.forEach(s => {
                    if (s.class === currentStudentClass) {
                        if (!classStudentsMap.has(s.id)) {
                            classStudentsMap.set(s.id, { id: s.id, name: s.name, class: s.class });
                        }
                    }
                });
            });

            const classmates = Array.from(classStudentsMap.values()).sort((a, b) => a.id.localeCompare(b.id)); // 按学号排序

            if (classmates.length === 0) {
                alert("未找到同班同学数据。");
                return;
            }

            // 2. 循环生成 HTML
            let fullHtml = "";

            classmates.forEach(mate => {
                // 为每个同学准备数据
                const mRankData = { classRank: [], gradeRank: [] };
                const mSubjectData = {};
                const mSubjectRankData = {};
                dynamicSubjects.forEach(sub => {
                    mSubjectData[sub] = [];
                    mSubjectRankData[sub] = { classRank: [], gradeRank: [] };
                });

                visibleExamData.forEach(exam => {
                    const s = exam.students.find(st => String(st.id) === String(mate.id));
                    if (s) {
                        mRankData.classRank.push(s.rank || null);
                        mRankData.gradeRank.push(s.gradeRank || null);
                        dynamicSubjects.forEach(sub => {
                            const score = s.scores[sub];
                            mSubjectData[sub].push((score !== null && score !== undefined) ? score : null);
                            let cRank = null, gRank = null;
                            if (typeof score === 'number' && !isNaN(score)) {
                                cRank = s.classRanks ? s.classRanks[sub] : null;
                                gRank = s.gradeRanks ? s.gradeRanks[sub] : null;
                            }
                            mSubjectRankData[sub].classRank.push(cRank);
                            mSubjectRankData[sub].gradeRank.push(gRank);
                        });
                    } else {
                        // 缺考
                        mRankData.classRank.push(null);
                        mRankData.gradeRank.push(null);
                        dynamicSubjects.forEach(sub => {
                            mSubjectData[sub].push(null);
                            mSubjectRankData[sub].classRank.push(null);
                            mSubjectRankData[sub].gradeRank.push(null);
                        });
                    }
                });

                // 生成单个HTML并追加
                fullHtml += generateSingleTableHTML(mate.name, mate.class, mate.id, mRankData, mSubjectData, mSubjectRankData);
            });

            // 3. 调用打印
            if (typeof startMultiTablePrintJob === 'function') {
                startMultiTablePrintJob(`${currentStudentClass}-批量成绩单`, fullHtml);
            } else {
                console.error("startMultiTablePrintJob 未定义");
                alert("打印功能函数 startMultiTablePrintJob 缺失");
            }
        });
    }
}

/**
 * (    ) 11.7. 打开“导入来源”模态框
 */
async function openImportModal() {
    const importModal = document.getElementById('import-modal');
    const importModalSelect = document.getElementById('import-modal-select');
    const importModalFromStorageBtn = document.getElementById('import-modal-from-storage');

    // 1. (复用) 加载“模块十二”的数据
    const multiData = await loadMultiExamData();

    // 2. 填充下拉框
    if (multiData.length > 0) {
        importModalSelect.innerHTML = multiData.map(exam => {
            const label = `${exam.label} ${exam.isHidden ? '(已隐藏)' : ''}`;
            return `<option value="${exam.id}">${label} (原始: ${exam.originalName})</option>`;
        }).join('');
        importModalSelect.disabled = false;
        importModalFromStorageBtn.disabled = false;
    } else {
        importModalSelect.innerHTML = '<option value="">“模块十二”中暂无数据</option>';
        importModalSelect.disabled = true;
        importModalFromStorageBtn.disabled = true;
    }

    // 3. 显示模态框
    importModal.style.display = 'flex';
}

// =====================================================================
//    NEW    模块十三：学科小题分析
// =====================================================================

/**
 * 13.1. 渲染模块十三 (学科小题分析) 的主界面
 * *    修正版 15    - 2025-11-12
 * - (Feature)     “题目-学生 诊断散点图”的 HTML 框架和下拉框。
 * - (Refactor) 更  事件监听器以包含  图表。
 */
function renderItemAnalysis(container) {
    if (container.dataset.initialized) {
        return;
    }
    container.dataset.initialized = 'true';

    // 1. 渲染基础HTML
    container.innerHTML = `
        <h2>模块十二：学科小题分析</h2>
        
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            请导入“小题分明细”Excel文件。系统将自动解析所有工作表(Sheet)，每个工作表代表一个科目。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; flex-wrap: wrap;">
                <label for="item-analysis-uploader" class="upload-label" style="padding: 10px 16px; background-color: var(--primary-color); color: white;">
                    📊 导入小题分明细 Excel
                </label>
                <input type="file" id="item-analysis-uploader" accept=".xlsx, .xls, .csv" style="display: none;">
                
                <button id="item-analysis-config-btn" class="sidebar-button" style="background-color: var(--color-orange); margin-left: 15px; display: none;">
                    ⚙️ 配置题目
                </button>
                <span id="item-analysis-status" style="margin-left: 15px; color: var(--text-muted);"></span>
            </div>
            <div class="main-card-wrapper" style="margin-bottom: 20px; border-left: 5px solid #6f42c1; background-color: #fdfaff;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <h4 style="margin:0; color:#6f42c1;">📂 小题分析数据归档库 (History)</h4>
                <div style="display:flex; gap:10px;">
                    <button id="item-lib-save-current-btn" class="sidebar-button" style="background-color:#28a745; font-size:0.85em;" disabled>
                        💾 保存当前数据
                    </button>
                     <button id="item-lib-clear-btn" class="sidebar-button" style="background-color:#dc3545; font-size:0.85em;">
                        🗑️ 清空库
                    </button>
                </div>
            </div>
            <p style="font-size:0.85em; color:#666; margin:5px 0 10px 0;">点击列表项可直接切换至该次考试分析。保存的数据包含题目配置和试卷文本。</p>
            
            <div id="item-analysis-library-list" class="multi-exam-list-container" style="max-height: 250px; overflow-y: auto; background:#fff;">
                <div style="padding:20px; text-align:center; color:#999;">加载中...</div>
            </div>
        </div>
        </div>

        

        <div id="item-analysis-results" style="display: none;">
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; margin-bottom: 0; flex-wrap: wrap;">
                    
                    <label for="item-subject-select" style="margin-left: 0;">科目:</label>
                    <select id="item-subject-select" class="sidebar-select" style="width: auto; min-width: 150px; margin-right: 15px;"></select>
                    
                    <label for="item-class-filter">班级:</label>
                    <select id="item-class-filter" class="sidebar-select" style="width: auto; min-width: 150px; margin-right: 15px;">
                        <option value="ALL">-- 全体 --</option>
                    </select>

                    <label for="item-layer-groups">学生分层数:</label>
                    <select id="item-layer-groups" class="sidebar-select" style="width: auto;">
                        <option value="10">10层 (高-低)</option>
                        <option value="5">5层 (高-低)</option>
                    </select>
                </div>
            </div>

            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
                    <div>
                        <h4 style="margin:0 0 10px 0;">📊 核心指标概览</h4>
                        <div id="item-kpi-grid" class="kpi-grid" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));"></div>
                    </div>
                    
                    <div style="border-left: 1px solid #eee; padding-left: 20px;">
                        <h4 style="margin:0 0 5px 0; text-align:center;">🧩 试卷难度结构</h4>
                        <div class="chart-container" id="item-difficulty-pie-chart" style="height: 220px;"></div>
                        <p style="text-align:center; font-size:0.8em; color:#999; margin:0;">(基于题目满分权重统计)</p>
                    </div>
                </div>
            </div>
            
            
            <h3 style="margin-top: 30px;">📊 各大题 (文字/字母) 分析</h3>
            
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div class="controls-bar chart-controls" style="padding: 0; border: none; margin-bottom: 10px;">
                    <label for="item-major-metric-select">选择指标:</label>
                    <select id="item-major-metric-select" class="sidebar-select" style="width: auto;">
                        <option value="difficulty">难度 (得分率)</option>
                        <option value="discrimination">区分度</option>
                    </select>
                </div>
                <div class="chart-container" id="item-chart-major" style="height: 400px;"></div>
            </div>
            <h3 style="margin-top: 30px;">📉 各大题得分率分层对比 (趋势图)</h3>
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <p style="color: var(--text-muted); font-size: 0.9em; text-align:center; margin-top: 0;">
                    柱状图为全体得分率，折线图为各分层学生得分率 (G1为最高分层)。
                </p>
                <div class="chart-container" id="item-chart-layered-major" style="height: 450px;"></div>
            </div>

            <h3 style="margin-top: 30px;">🔬 各小题 (数字) 分析</h3>
            <div class="main-card-wrapper" style="gap: 20px; margin-bottom: 20px;">
                <div class="controls-bar chart-controls" style="padding: 0; border: none;">
                    <label for="item-minor-metric-select">选择指标:</label>
                    <select id="item-minor-metric-select" class="sidebar-select" style="width: auto;">
                        <option value="difficulty">难度 (得分率)</option>
                        <option value="discrimination">区分度</option>
                    </select>
                </div>
                <div class="chart-container" id="item-chart-minor" style="height: 400px;"></div>
            </div>

            <h3 style="margin-top: 30px;">📉 小题得分率分层对比</h3>
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                    柱状图为全体学生得分率，折线图为按总分分层后各层学生的得分率 (G1为最高分层)。
                </p>
                <div class="chart-container" id="item-chart-layered" style="height: 500px;"></div>
            </div>

            <div class="main-card-wrapper" style="margin-bottom: 20px; border-left: 5px solid #17a2b8;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">
                    <div style="display:flex; flex-direction:column;">
                        <h3 style="margin:0;">👥 分层学生名单查询</h3>
                        <span style="font-size:0.8em; color:#666; margin-top:4px;">查看特定分数段（层级）内的学生分布</span>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap:10px;">
                         <label style="font-weight:bold;">选择层级:</label>
                         <select id="item-layer-list-select" class="sidebar-select" style="width:auto; min-width:150px; font-weight:bold; color:#17a2b8;">
                             </select>
                         <button id="btn-export-layer-list" class="sidebar-button" style="background-color:var(--color-green); font-size:0.9em; padding:6px 12px;">
                            📥 导出该层名单
                         </button>
                    </div>
                </div>
                
                <div class="table-container" style="max-height: 400px; overflow-y: auto;">
                    <table id="item-layer-table">
                        <thead>
                            <tr>
                                <th>层级名称</th>
                                <th>姓名</th>
                                <th>班级</th>
                                <th>总分</th>
                                <th>本题组得分 (如适用)</th>
                                <th>班排</th>
                                <th>年排</th>
                            </tr>
                        </thead>
                        <tbody id="item-layer-tbody">
                            </tbody>
                    </table>
                </div>
            </div>
            
            <h3 style="margin-top: 30px;">📈 知识点掌握情况 (分层对比)</h3>
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                    对比不同分数层 (G1为最高分层) 在各个知识点上的得分率。
                </p>
                <div class="chart-container" id="item-chart-knowledge" style="height: 500px;"></div>
            </div>

            <h3 style="margin-top: 30px;">🎯 学生个体知识点诊断表</h3>
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                
                <div class="controls-bar chart-controls" style="padding: 0; border: none; flex-wrap: wrap; justify-content: space-between;">
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        
                        <label for="item-outlier-type-filter">题目类型:</label>
                        <select id="item-outlier-type-filter" class="sidebar-select" style="width: auto;">
                            <option value="all">大题+小题</option>
                            <option value="minor">仅小题</option>
                            <option value="major">仅大题</option>
                        </select>
                        
                        <label for="item-outlier-sort" style="margin-left: 15px;">排序方式:</label>
                        <select id="item-outlier-sort" class="sidebar-select" style="width: auto;">
                            <option value="weakness">按“最短板”排序 (高分低能)</option>
                            <option value="strength">按“最亮点”排序 (低分高能)</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <label for="item-outlier-search">索引学生:</label>
                        <input type="text" id="item-outlier-search" placeholder="输入姓名或考号..." style="width: 150px;">
                    </div>
                    <button id="item-print-btn" class="sidebar-button" style="background-color: var(--color-blue); margin-left: auto;">
                        🖨️ 打印
                    </button>
                </div>

                <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                    “偏差” = 学生知识点得分率 - 该层平均知识点得分率。 (点击学生查看题目详情)
                </p>
                <div class="table-container" id="item-outlier-table-container" style="max-height: 600px; overflow-y: auto;">
                </div>
                
                <div id="item-student-detail-container" style="display: none; margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                </div>

            </div>

            <h3 style="margin-top: 30px;">🎯 题目-学生 诊断散点图</h3>
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div class="controls-bar chart-controls" style="padding: 0; border: none; flex-wrap: wrap;">
                    <label for="item-scatter-question-select">选择题目:</label>
                    <select id="item-scatter-question-select" class="sidebar-select" style="width: auto; min-width: 150px;"></select>
                </div>
                <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                    分析学生“总分”与“单题得分”的关系。左上象限 (高总分 - 低题分) 为“短板学生”，值得重点关注。
                </p>
                <div class="chart-container" id="item-chart-scatter-quadrant" style="height: 500px;"></div>
            </div>

            <h3 style="margin-top: 30px;">🕸️ 知识点归因图谱 (Remedial Path)</h3>
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                    <span style="display:inline-block; width:10px; height:10px; background:#dc3545; border-radius:50%;"></span> 红色节点：薄弱知识点 (<60%) &nbsp;&nbsp;
                    <span style="display:inline-block; width:10px; height:10px; background:#28a745; border-radius:50%;"></span> 绿色节点：掌握良好 (>85%) <br>
                    <strong>粗红线</strong> 表示“连锁崩塌”路径（前置知识点未掌握导致后继知识点崩塌）。
                </p>
                <div class="chart-container" id="item-chart-knowledge-graph" style="height: 600px;"></div>
            </div>

            </div>  <h3 style="margin-top: 40px; border-top: 2px dashed #ccc; padding-top: 20px;">⚖️ 跨考试难度加权对比 (Custom Difficulty Metric)</h3>
            <div class="main-card-wrapper" style="margin-bottom: 40px; border-left: 5px solid #d35400; background-color: #fff5e6;">
                <p style="color: #666; font-size: 0.9em;">
                    <strong>算法说明：</strong> 指标 = ∑ [ (1 - 预设难度) × 该题总得分 ] / 参考人数。<br>
                    请确保在“配置题目”中已填写难度系数（0.0~1.0，数值越小越难），否则默认难度为 0。
                </p>
                
                <div class="controls-bar" style="background: transparent; padding: 0; flex-wrap: wrap; gap: 15px;">
                    <div>
                        <label style="font-weight:bold;">考试 A (基准):</label>
                        <select id="comp-exam-a" class="sidebar-select" style="width: 200px;"></select>
                    </div>
                    <div>
                        <label style="font-weight:bold;">考试 B (对比):</label>
                        <select id="comp-exam-b" class="sidebar-select" style="width: 200px;"></select>
                    </div>
                    <div>
                        <label style="font-weight:bold;">分析科目:</label>
                        <select id="comp-subject-select" class="sidebar-select" style="width: 120px;"></select>
                    </div>
                    <button id="btn-run-diff-compare" class="sidebar-button" style="background-color: #d35400;">📊 开始对比</button>
                </div>

                <div class="dashboard-chart-grid-2x2" style="margin-top: 20px;">
                    <div class="main-card-wrapper">
                        <h4 style="text-align:center; margin:0;">年段/班级 指标对比</h4>
                        <div class="chart-container" id="chart-diff-compare-bar" style="height: 400px;"></div>
                    </div>
                    <div class="main-card-wrapper">
                        <h4 style="text-align:center; margin:0;">指标差异 (考试 A - 考试 B)</h4>
                        <div class="chart-container" id="chart-diff-compare-diff" style="height: 400px;"></div>
                    </div>
                </div>
            </div>

        </div>
    `;

    // 2. 绑定 DOM 元素 (只绑定一次)
    const uploader = document.getElementById('item-analysis-uploader');
    const statusLabel = document.getElementById('item-analysis-status');
    const subjectSelect = document.getElementById('item-subject-select');
    const classFilter = document.getElementById('item-class-filter');
    const configBtn = document.getElementById('item-analysis-config-btn');
    const minorMetricSelect = document.getElementById('item-minor-metric-select');
    const majorMetricSelect = document.getElementById('item-major-metric-select');
    const layerGroupSelect = document.getElementById('item-layer-groups');
    const outlierTypeFilter = document.getElementById('item-outlier-type-filter');
    const outlierSortSelect = document.getElementById('item-outlier-sort');
    const outlierSearch = document.getElementById('item-outlier-search');
    const outlierTableContainer = document.getElementById('item-outlier-table-container');
    const detailTableContainer = document.getElementById('item-student-detail-container');
    const scatterQSelect = document.getElementById('item-scatter-question-select'); //    NEW   


    // 3. 辅助函数来填充UI (不变)
    const populateItemAnalysisUI = (itemData) => {
        const subjects = Object.keys(itemData);
        if (subjects.length === 0) {
            document.getElementById('item-analysis-results').style.display = 'none';
            configBtn.style.display = 'none';
            return;
        }

        document.getElementById('item-analysis-results').style.display = 'block';
        configBtn.style.display = 'inline-block';
        subjectSelect.innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');

        renderItemAnalysisCharts();
    };

    // [    ] 分层名单下拉框变更事件
    const layerListSelect = document.getElementById('item-layer-list-select');
    if (layerListSelect) {
        layerListSelect.addEventListener('change', () => {
            drawLayerStudentTable(); // 仅重绘表格
        });
    }

    // [    ] 导出按钮事件
    const exportLayerBtn = document.getElementById('btn-export-layer-list');
    if (exportLayerBtn) {
        exportLayerBtn.addEventListener('click', () => {
            const subject = document.getElementById('item-subject-select').value;
            const layerName = layerListSelect.options[layerListSelect.selectedIndex].text;
            exportLayerTableToExcel(subject, layerName);
        });
    }

    // 4. 绑定文件上传事件 (修复版：允许连续导入)
    uploader.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusLabel.innerText = `🔄 正在解析 ${file.name}...`;
        try {
            // [修复] 确保传递的是包含 _global_settings_ 的完整配置对象
            // 优先使用内存中的 G_ItemAnalysisConfig，如果为空则尝试从空对象开始
            let fullConfig = window.G_ItemAnalysisConfig || {};

            // [建议    ] 如果内存为空，尝试同步读取一下本地存储(虽然通常已加载，但为了保险)
            if (Object.keys(fullConfig).length === 0) {
                const stored = await localforage.getItem('G_ItemAnalysisConfig');
                if (stored) fullConfig = stored;
            }

            const itemData = await loadItemAnalysisExcel(file, fullConfig);

            G_ItemAnalysisData = itemData;

            await localforage.setItem('G_ItemAnalysisData', itemData);
            await localforage.setItem('G_ItemAnalysisFileName', file.name);

            const subjects = Object.keys(itemData);
            if (subjects.length === 0) {
                throw new Error("在文件中未找到任何包含有效数据的工作表。");
            }
            statusLabel.innerText = `✅ 已加载: ${file.name} (共 ${subjects.length} 科)`;
            populateItemAnalysisUI(itemData);

            const saveBtn = document.getElementById('item-lib-save-current-btn');
            if (saveBtn) saveBtn.disabled = false;
        } catch (err) {
            console.error(err);
            statusLabel.innerText = `❌ 解析失败: ${err.message}`;
            alert(`解析失败: ${err.message}`);
        } finally {
            //    核心修复    无论成功或失败，都重置文件输入框的值，允许连续触发 change 事件
            event.target.value = '';
        }
    });
    // 5. 绑定下拉框切换事件 (主触发器) (不变)
    subjectSelect.addEventListener('change', () => {
        classFilter.value = 'ALL';
        layerGroupSelect.value = '10';
        minorMetricSelect.value = 'difficulty';
        majorMetricSelect.value = 'difficulty';
        outlierTypeFilter.value = 'all';
        outlierSortSelect.value = 'weakness';
        outlierSearch.value = '';
        // scatterQSelect 会在 renderItemAnalysisCharts 中被自动填充和重绘
        renderItemAnalysisCharts();
    });

    //    修正    班级筛选器 (主触发器)
    classFilter.addEventListener('change', () => {
        renderItemAnalysisCharts(); // 重绘所有 (KPIs 和  图表需要)
    });

    //    修正    (高效触发器)
    layerGroupSelect.addEventListener('change', () => {
        // 只重绘依赖分层的图表
        drawItemAnalysisLayeredChart();
        drawItemAnalysisLayeredMajorChart();
        drawItemAnalysisKnowledgeChart();
        drawItemAnalysisOutlierTable();
    });

    // 6. 绑定指标下拉框切换事件 (不变)
    minorMetricSelect.addEventListener('change', () => {
        drawItemAnalysisChart('minor');
    });
    majorMetricSelect.addEventListener('change', () => {
        drawItemAnalysisChart('major');
    });

    // 7. 绑定诊断表 (不变)
    outlierTypeFilter.addEventListener('change', () => {
        drawItemAnalysisOutlierTable();
    });
    outlierSortSelect.addEventListener('change', () => {
        drawItemAnalysisOutlierTable();
    });
    outlierSearch.addEventListener('input', () => {
        drawItemAnalysisOutlierTable();
    });

    // 8. 绑定诊断表 *点击* 事件 (不变)
    outlierTableContainer.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;

        G_ItemDetailSort = { key: 'deviation', direction: 'asc' };
        const studentId = row.dataset.id;
        const studentName = row.dataset.name;
        const studentLayer = row.dataset.layer;
        const questionType = document.getElementById('item-outlier-type-filter').value;

        outlierTableContainer.querySelectorAll('tr.active').forEach(tr => tr.classList.remove('active'));
        row.classList.add('active');

        drawItemStudentDetailTable(studentId, studentName, studentLayer, questionType);
    });

    // 9. 绑定 *详情表* 表头点击事件 (不变)
    detailTableContainer.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;

        const newKey = th.dataset.sortKey;
        const { key, direction } = G_ItemDetailSort;
        if (newKey === key) {
            G_ItemDetailSort.direction = (direction === 'asc') ? 'desc' : 'asc';
        } else {
            G_ItemDetailSort.key = newKey;
            G_ItemDetailSort.direction = (newKey === 'deviation' || newKey === 'studentScore') ? 'asc' : 'asc';
        }

        const activeRow = outlierTableContainer.querySelector('tr.active');
        if (!activeRow) return;

        const studentId = activeRow.dataset.id;
        const studentName = activeRow.dataset.name;
        const studentLayer = activeRow.dataset.layer;
        const questionType = document.getElementById('item-outlier-type-filter').value;

        drawItemStudentDetailTable(studentId, studentName, studentLayer, questionType);
    });

    // 10.    NEW (Feature)    绑定  散点图的下拉框
    scatterQSelect.addEventListener('change', () => {
        drawItemScatterQuadrantChart();
    });

    const itemPrintBtn = document.getElementById('item-print-btn');
    if (itemPrintBtn) {
        //    核心    按钮点击时，调用  的多功能打印函数
        itemPrintBtn.addEventListener('click', startItemDetailPrintJob);
    }

    // 11. 绑定配置按钮和模态框事件
    configBtn.addEventListener('click', populateItemAnalysisConfigModal);
    document.getElementById('item-config-modal-close-btn').addEventListener('click', () => {
        document.getElementById('item-analysis-config-modal').style.display = 'none';
    });
    document.getElementById('item-config-modal-save-btn').addEventListener('click', () => {
        saveItemAnalysisConfigFromModal();
        renderItemAnalysisCharts(); //    保存配置后重绘所有
    });

    (async () => {
        try {
            const statusLabel = document.getElementById('item-analysis-status');

            // 并行获取配置和数据
            const [storedConfig, storedData, storedFileName] = await Promise.all([
                localforage.getItem('G_ItemAnalysisConfig'),
                localforage.getItem('G_ItemAnalysisData'),
                localforage.getItem('G_ItemAnalysisFileName')
            ]);

            if (storedConfig) {
                G_ItemAnalysisConfig = storedConfig;
            }

            if (storedData) {
                G_ItemAnalysisData = storedData;

                //    如果有文件名，就显示文件名；否则显示默认提示
                if (storedFileName) {
                    statusLabel.innerText = `✅ 已加载: ${storedFileName}`;
                } else {
                    statusLabel.innerText = "✅ 已从数据库加载数据。";
                }

                populateItemAnalysisUI(G_ItemAnalysisData);

                // =================================================
                //    核心修复    自动加载成功后，必须激活“保存”按钮
                // =================================================
                const saveBtn = document.getElementById('item-lib-save-current-btn');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.style.opacity = "1"; // 确保样式也恢复
                    saveBtn.style.cursor = "pointer";
                }
                // =================================================

            } else {
                statusLabel.innerText = "请导入小题分明细 Excel。";
            }
        } catch (e) {
            console.error("加载小题分缓存失败:", e);
            const statusLabel = document.getElementById('item-analysis-status');
            if (statusLabel) statusLabel.innerText = "缓存加载失败，请重  导入。";

            // 出错时清理可能损坏的数据
            localforage.removeItem('G_ItemAnalysisData');
            localforage.removeItem('G_ItemAnalysisConfig');
        }
    })();
    // ============================================================
    // [修复] 小题分析归档库：事件绑定与渲染逻辑
    // ============================================================
    const libListContainer = document.getElementById('item-analysis-library-list');
    const libSaveBtn = document.getElementById('item-lib-save-current-btn');
    const libClearBtn = document.getElementById('item-lib-clear-btn');

    // 1. 渲染存档列表函数
    const renderLibraryList = async () => {

        const library = await localforage.getItem('G_ItemAnalysis_Library') || [];
        refreshLibraryUI(library);

        if (library.length === 0) {
            libListContainer.innerHTML = `<div style="padding:20px; text-align:center; color:#999;">暂无存档数据</div>`;
            return;
        }

        libListContainer.innerHTML = library.map((item, index) => `
            <div class="multi-exam-item" style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div onclick="window.loadItemFromLibrary('${item.id}')" style="flex-grow:1; cursor:pointer;">
                    <div style="font-weight:bold; color:#333;">${index + 1}. ${item.name}</div>
                    <div style="font-size:0.8em; color:#999;">📅 ${item.date} | 📚 ${item.subjects.length} 个科目</div>
                </div>
                <div style="display:flex; gap:5px;">
                    <button onclick="window.renameItemFromLibrary('${item.id}')" class="sidebar-button" 
                        style="background-color:#17a2b8; padding:2px 8px; font-size:0.8em; border:none;">
                        重命名
                    </button>
                    
                    <button onclick="window.deleteItemFromLibrary('${item.id}')" class="sidebar-button" 
                        style="background-color:#fff; color:#dc3545; border:1px solid #dc3545; padding:2px 8px; font-size:0.8em;">
                        删除
                    </button>
                </div>
            </div>
        `).join('');
    };

    // 2. 绑定“保存当前数据”点击事件
    if (libSaveBtn) {
        //    优化    直接绑定即可，不需要 cloneNode，因为 initialized 标记保证了只会执行一次
        libSaveBtn.onclick = async () => { // 使用 onclick 覆盖之前的事件，防止重复
            // 检查是否有数据
            if (!G_ItemAnalysisData || Object.keys(G_ItemAnalysisData).length === 0) {
                alert("当前没有可保存的数据！请先导入 Excel。");
                return;
            }

            // 获取文件名作为默认标题
            let defaultName = "我的小题分析";
            const storedFileName = await localforage.getItem('G_ItemAnalysisFileName');
            if (storedFileName) defaultName = storedFileName.replace(/\.xlsx|\.xls|\.csv/g, '');

            const name = prompt("请为该存档命名:", defaultName);
            if (!name) return;

            // 构建存档对象
            const record = {
                id: Date.now().toString(),
                name: name,
                date: new Date().toLocaleString(),
                data: G_ItemAnalysisData,
                config: G_ItemAnalysisConfig,
                fileName: storedFileName || name,
                subjects: Object.keys(G_ItemAnalysisData)
            };

            // 保存到 IndexedDB
            let library = await localforage.getItem('G_ItemAnalysis_Library');
            if (!Array.isArray(library)) library = []; // 确保是数组

            library.unshift(record);
            await localforage.setItem('G_ItemAnalysis_Library', library);

            alert("✅ 保存成功！您可以在下方列表中随时切换回此数据。");
            renderLibraryList(); // 刷  列表
        };
    }

    // 3. 绑定“清空库”点击事件
    if (libClearBtn) {
        // 同样做一次克隆替换，防止重复绑定
        const newClearBtn = libClearBtn.cloneNode(true);
        libClearBtn.parentNode.replaceChild(newClearBtn, libClearBtn);

        newClearBtn.addEventListener('click', async () => {
            if (confirm("⚠️ 确定要清空所有小题分析的存档吗？\n此操作不可恢复！")) {
                await localforage.removeItem('G_ItemAnalysis_Library');
                renderLibraryList();
            }
        });
    }

    // 4. 初始化时渲染列表
    renderLibraryList();
}


/**
 * [新增] 13.22. 绘制“各大题”得分率分层对比图
 * 逻辑与小题分层图类似，但针对 Major Questions
 */
function drawItemAnalysisLayeredMajorChart() {
    const chartDom = document.getElementById('item-chart-layered-major');
    if (!chartDom) return;

    if (echartsInstances['item-chart-layered-major']) {
        echartsInstances['item-chart-layered-major'].dispose();
    }
    echartsInstances['item-chart-layered-major'] = echarts.init(chartDom);

    // 1. 获取参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);

    // 2. 获取数据源
    const rawData = G_ItemAnalysisData[subjectName];
    if (!rawData || !rawData.majorQuestions || rawData.majorQuestions.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">本科目无“大题”数据。</p>`;
        return;
    }

    const allStudents = rawData.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. 获取大题列表 (X轴)
    const qNames = rawData.majorQuestions; // 例如 ["作文", "听力", "翻译"]

    // 4. 计算分层数据
    // 复用 calculateLayeredItemStats 函数，它已经计算了 groupStats (包含了大题数据)
    const { groupStats } = calculateLayeredItemStats(subjectName, numGroups, filteredStudents);

    // 5. 获取全体平均得分率 (用于柱状图背景)
    const recalculatedStats = getRecalculatedItemStats(subjectName);
    const overallDifficulty = qNames.map(qName => {
        return recalculatedStats.majorStats[qName]?.difficulty || 0;
    });

    // 6. 准备 Series
    const series = [];
    const legendData = [];

    // (背景柱状图：全体平均)
    series.push({
        name: '全体得分率',
        type: 'bar',
        data: overallDifficulty,
        barWidth: '50%',
        itemStyle: { opacity: 0.3, color: '#909399' },
        barGap: '-100%', // 让柱子作为背景
        z: 1,
        animation: false
    });
    legendData.push('全体得分率');

    // (折线图：各层级)
    const lineColors = [
        '#007bff', '#28a745', '#17a2b8', '#ffc107', '#fd7e14',
        '#6f42c1', '#dc3545', '#e83e8c', '#6c757d', '#343a40'
    ];

    Object.keys(groupStats).sort().forEach((groupName, index) => {
        legendData.push(groupName);
        series.push({
            name: groupName,
            type: 'line',
            smooth: 0.3, // 平滑曲线
            symbol: 'circle',
            symbolSize: 6,
            // 从 groupStats 中提取对应大题的数据
            data: qNames.map(qName => groupStats[groupName][qName] || 0),
            color: lineColors[index % lineColors.length],
            z: 10
        });
    });

    // 7. ECharts 配置
    const option = {
        tooltip: { 
            trigger: 'axis', 
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                let html = `<strong>${params[0].name}</strong><br/>`;
                params.forEach(p => {
                    const val = (p.value * 100).toFixed(1) + '%';
                    html += `${p.marker} ${p.seriesName}: <strong>${val}</strong><br/>`;
                });
                return html;
            }
        },
        legend: { data: legendData, top: 0, type: 'scroll' },
        grid: { left: '3%', right: '4%', bottom: '10%', top: 40, containLabel: true },
        xAxis: {
            type: 'category',
            data: qNames,
            axisLabel: { 
                interval: 0, 
                rotate: qNames.length > 5 ? 30 : 0 // 如果题目多则倾斜
            }
        },
        yAxis: { 
            type: 'value', 
            name: '得分率', 
            min: 0, 
            max: 1,
            axisLabel: { formatter: (value) => (value * 100).toFixed(0) + '%' }
        },
        series: series
    };

    echartsInstances['item-chart-layered-major'].setOption(option, { notMerge: true });
}

// ==========================================
// [    ] 全局函数：小题库的加载与删除
// ==========================================

// 加载存档
window.loadItemFromLibrary = async (id) => {
    const library = await localforage.getItem('G_ItemAnalysis_Library') || [];
    const record = library.find(r => r.id === id);

    if (!record) { alert("未找到该记录，可能已被删除。"); return; }
    if (!confirm(`确定要加载存档：\n【${record.name}】吗？\n\n注意：当前未保存的分析界面将被覆盖。`)) return;

    // 1. 恢复全局变量
    G_ItemAnalysisData = record.data;
    G_ItemAnalysisConfig = record.config || {};

    // 2. 更  当前环境缓存 (保证刷  页面后还在)
    await localforage.setItem('G_ItemAnalysisData', G_ItemAnalysisData);
    await localforage.setItem('G_ItemAnalysisConfig', G_ItemAnalysisConfig);
    await localforage.setItem('G_ItemAnalysisFileName', record.fileName);

    // 3. 刷   UI
    // 这里我们模拟一次“重  选择模式”来触发刷  ，或者手动调用填充逻辑
    const subjectSelect = document.getElementById('item-subject-select');
    const statusLabel = document.getElementById('item-analysis-status');
    const saveBtn = document.getElementById('item-lib-save-current-btn');
    const configBtn = document.getElementById('item-analysis-config-btn');

    if (subjectSelect) {
        const subjects = Object.keys(G_ItemAnalysisData);
        // 填充科目下拉框
        subjectSelect.innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');

        // 显示相关按钮
        document.getElementById('item-analysis-results').style.display = 'block';
        if (configBtn) configBtn.style.display = 'inline-block';
        if (saveBtn) saveBtn.disabled = false;
        if (statusLabel) statusLabel.innerText = `📂 已加载存档: ${record.name}`;

        // 触发重绘 (模拟用户切换了科目)
        renderItemAnalysisCharts();
    }
};

// ==========================================
// [    ] 全局函数：重命名存档
// ==========================================
window.renameItemFromLibrary = async (id) => {
    let library = await localforage.getItem('G_ItemAnalysis_Library') || [];
    const item = library.find(r => r.id === id);

    if (!item) return;

    // 弹出输入框
    const newName = prompt("请输入  的存档名称:", item.name);

    // 如果用户点击取消或输入为空，则不处理
    if (newName === null || newName.trim() === "") return;

    // 更  名称
    item.name = newName.trim();

    // 保存回数据库
    await localforage.setItem('G_ItemAnalysis_Library', library);

    // 刷   UI (复用下方的渲染逻辑)
    refreshLibraryUI(library);
};

// ==========================================
// [修改] 全局函数：删除存档 (更  渲染逻辑以包含重命名按钮)
// ==========================================
window.deleteItemFromLibrary = async (id) => {
    // event.stopPropagation() 不需要，因为按钮不在 onclick div 内部，而是兄弟节点
    if (!confirm("确定删除这条存档吗？此操作不可恢复。")) return;

    let library = await localforage.getItem('G_ItemAnalysis_Library') || [];
    library = library.filter(r => r.id !== id);
    await localforage.setItem('G_ItemAnalysis_Library', library);

    // 刷   UI
    refreshLibraryUI(library);
};


// [辅助函数] 用于全局刷  列表 UI (已更  ：添加“切换”按钮)
function refreshLibraryUI(library) {
    const container = document.getElementById('item-analysis-library-list');
    if (container) {
        if (library.length === 0) {
            container.innerHTML = `<div style="padding:20px; text-align:center; color:#999;">暂无存档数据</div>`;
        } else {
            container.innerHTML = library.map((item, index) => `
                <div class="multi-exam-item" style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                    
                    <div onclick="window.loadItemFromLibrary('${item.id}')" style="flex-grow:1; cursor:pointer; padding-right: 10px;">
                        <div style="font-weight:bold; color:#333;">${index + 1}. ${item.name}</div>
                        <div style="font-size:0.8em; color:#999;">📅 ${item.date} | 📚 ${item.subjects.length} 个科目</div>
                    </div>

                    <div style="display:flex; gap:5px;">
                        
                        <button onclick="window.loadItemFromLibrary('${item.id}')" class="sidebar-button" 
                            style="background-color:#28a745; padding:2px 8px; font-size:0.8em; border:none;" title="加载此存档">
                            📂 切换
                        </button>

                        <button onclick="window.renameItemFromLibrary('${item.id}')" class="sidebar-button" 
                            style="background-color:#17a2b8; padding:2px 8px; font-size:0.8em; border:none;">
                            重命名
                        </button>
                        
                        <button onclick="window.deleteItemFromLibrary('${item.id}')" class="sidebar-button" 
                            style="background-color:#fff; color:#dc3545; border:1px solid #dc3545; padding:2px 8px; font-size:0.8em;">
                            删除
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }
}

/**
 * 13.2. [核心] 解析小题分 Excel 文件
 *    最终完整版    支持动态跳过末尾统计行，并接收配置上下文。
 */
function loadItemAnalysisExcel(file, globalConfig = {}) { // [关键修改] 接收配置对象
    return new Promise((resolve, reject) => {

        //    内部辅助函数    (不变)
        const _calculateQuestionStats = (qNames, scoreType, processedData) => {
            const stats = {};
            for (const qName of qNames) {
                const qScores = [];
                const tScores = [];
                processedData.forEach(s => {
                    const qScore = s[scoreType][qName];
                    const tScore = s.totalScore;
                    if (typeof qScore === 'number' && !isNaN(qScore) && typeof tScore === 'number' && !isNaN(tScore)) {
                        qScores.push(qScore);
                        tScores.push(tScore);
                    }
                });
                if (qScores.length === 0) continue;
                const qAvg = qScores.reduce((a, b) => a + b, 0) / qScores.length;
                const maxQScore = Math.max(...qScores);
                const qDifficulty = (maxQScore > 0) ? (qAvg / maxQScore) : 0;
                // 假设 calculateCorrelation 已在全局定义
                const qDiscrimination = calculateCorrelation(qScores, tScores);
                stats[qName] = {
                    avg: parseFloat(qAvg.toFixed(2)),
                    maxScore: maxQScore,
                    difficulty: parseFloat(qDifficulty.toFixed(2)),
                    discrimination: parseFloat(qDiscrimination.toFixed(3))
                };
            }
            return stats;
        };

        // --- FileReader 开始 ---
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const allResults = {};

                for (const sheetName of workbook.SheetNames) {
                    const worksheet = workbook.Sheets[sheetName];
                    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                    if (rawData.length < 5) {
                        console.warn(`工作表 "${sheetName}" 数据行数不足，已跳过。`);
                        continue;
                    }

                    // 1. 定位表头行
                    let keyRowIndex = -1;
                    const REQUIRED_METRICS = ["姓名", "班级", "总分"];
                    for (let i = 0; i < Math.min(rawData.length, 5); i++) {
                        const row = rawData[i].map(String).map(s => s.trim());
                        const foundCount = REQUIRED_METRICS.filter(metric => row.includes(metric)).length;
                        if (foundCount === REQUIRED_METRICS.length) {
                            keyRowIndex = i;
                            break;
                        }
                    }
                    if (keyRowIndex === -1) {
                        console.warn(`工作表 "${sheetName}" 缺少关键字段 (${REQUIRED_METRICS.join(',')}), 已跳过。`);
                        continue;
                    }

                    const keyHeader = rawData[keyRowIndex].map(String).map(s => s.trim());
                    const studentDataStartRow = keyRowIndex + 1;
                    const colMap = {};
                    const majorQuestionColumns = [];
                    const minorQuestionColumns = [];
                    const isMinorQuestion = /^\d/;
                    let foundTotalScore = false;

                    // 2. 映射列
                    for (let i = 0; i < keyHeader.length; i++) {
                        const key = keyHeader[i];
                        if (key === "") continue;
                        if (key === "考号") { colMap[i] = "id"; continue; }
                        if (key === "姓名") { colMap[i] = "name"; continue; }
                        if (key === "班级") { colMap[i] = "class"; continue; }
                        if (key === "总分") {
                            colMap[i] = "totalScore";
                            foundTotalScore = true;
                            continue;
                        }
                        const knownInfoCols = ["学校", "班级排名", "年级排名", "准考证号", "学生属性", "班次", "校次", "客观题", "主观题", "教师", "阅卷班级", "校次进退步", "班次进退步"];

                        if (foundTotalScore && !knownInfoCols.includes(key)) {
                            const qName = String(key);
                            if (isMinorQuestion.test(qName)) {
                                colMap[i] = "q_minor_" + qName;
                                minorQuestionColumns.push(qName);
                            } else {
                                colMap[i] = "q_major_" + qName;
                                majorQuestionColumns.push(qName);
                            }
                        }
                    }


                    // 3. 动态确定要跳过的行数 (健壮版)
                    const skipSetting = globalConfig._global_settings_ || {};

                    // 如果设置了值且不是NaN，则使用该值；否则使用默认值 3
                    const rowsToSkipCount = skipSetting.rowsToSkip !== undefined && !isNaN(parseInt(skipSetting.rowsToSkip)) ?
                        parseInt(skipSetting.rowsToSkip) :
                        3;

                    // 如果 rowsToSkipCount > 0, 则 slice(start, -skipCount); 否则 slice(start, end)
                    const skipSliceEnd = rowsToSkipCount > 0 ? -rowsToSkipCount : rawData.length;

                    // 4. 解析学生数据行 (使用修正后的 slice 终点)
                    const studentRows = rawData.slice(studentDataStartRow, skipSliceEnd);
                    const processedData = [];


                    for (const row of studentRows) {
                        const student = { minorScores: {}, majorScores: {} };
                        let hasName = false;
                        for (const colIndex in colMap) {
                            const key = colMap[colIndex];
                            const rawValue = row[colIndex];
                            if (key.startsWith("q_minor_")) {
                                const qName = key.substring(8);
                                const score = parseFloat(rawValue);
                                student.minorScores[qName] = isNaN(score) ? null : score;
                            } else if (key.startsWith("q_major_")) {
                                const qName = key.substring(8);
                                const score = parseFloat(rawValue);
                                student.majorScores[qName] = isNaN(score) ? null : score;
                            } else if (key === "totalScore") {
                                const score = parseFloat(rawValue);
                                student.totalScore = isNaN(score) ? null : score;
                            } else {
                                const value = String(rawValue || "").trim();
                                student[key] = value;
                                if (key === 'name' && value) hasName = true;
                            }
                        }
                        if (!student.id && student.name) student.id = student.name;

                        // 确保学生有姓名 和 有效的总分
                        if (student.id && hasName && student.totalScore !== null) {
                            processedData.push(student);
                        }
                    }

                    if (processedData.length === 0) {
                        console.warn(`工作表 "${sheetName}" 解析完成，但未找到有效学生数据。`);
                        continue;
                    }

                    // 5. 计算统计数据
                    const minorQuestionStats = _calculateQuestionStats(minorQuestionColumns, 'minorScores', processedData);
                    const majorQuestionStats = _calculateQuestionStats(majorQuestionColumns, 'majorScores', processedData);

                    allResults[sheetName] = {
                        students: processedData,
                        minorQuestions: minorQuestionColumns,
                        majorQuestions: majorQuestionColumns,
                        minorStats: minorQuestionStats,
                        majorStats: majorQuestionStats
                    };
                }
                resolve(allResults);
            } catch (err) {
                console.error(err);
                reject(new Error("文件解析失败: ".concat(err.message || "未知错误。")));
            }
        };
        reader.onerror = (err) => reject(new Error("文件读取失败: ".concat(err)));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 13.3. 渲染小题分析图表
 * *    修正版 15    - 2025-11-12
 * - (Feature) 填充 "题目-学生 诊断散点图" 的下拉框。
 * - (Feature) 调用 drawItemScatterQuadrantChart()。
 * - (Bug 修复) 修复了 subjectName is not defined 的 Bug。
 */
function renderItemAnalysisCharts() {
    const selectedSubject = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;

    const detailContainer = document.getElementById('item-student-detail-container');
    if (detailContainer) detailContainer.style.display = 'none';
    G_ItemDetailSort = { key: 'deviation', direction: 'asc' };

    if (!G_ItemAnalysisData || !G_ItemAnalysisData[selectedSubject]) {
        // ... (错误处理) ...
        document.getElementById('item-chart-minor').innerHTML = "";
        document.getElementById('item-chart-major').innerHTML = "";
        document.getElementById('item-chart-layered').innerHTML = "";
        document.getElementById('item-chart-knowledge').innerHTML = "";
        document.getElementById('item-outlier-table-container').innerHTML = "";
        document.getElementById('item-kpi-grid').innerHTML = "";
        document.getElementById('item-chart-scatter-quadrant').innerHTML = ""; //    NEW   
        return;
    }
    const data = G_ItemAnalysisData[selectedSubject];
    const allStudents = data.students || [];

    // 1. 填充班级筛选器
    populateItemClassFilter(allStudents);

    // 2. 获取筛选后的学生
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. (不变) 计算和渲染KPIs
    const kpiContainer = document.getElementById('item-kpi-grid');
    const validStudents = filteredStudents.filter(s => typeof s.totalScore === 'number' && !isNaN(s.totalScore));
    const studentScores = validStudents.map(s => s.totalScore);

    let avgTotal = 0;
    let maxTotal = 0;
    let minTotal = 0;
    let stdDev = 0;
    if (studentScores.length > 0) {
        avgTotal = studentScores.reduce((a, b) => a + b, 0) / studentScores.length;
        maxTotal = Math.max(...studentScores);
        minTotal = Math.min(...studentScores);

        if (studentScores.length > 1) {
            const variance = studentScores.reduce((acc, score) => acc + Math.pow(score - avgTotal, 2), 0) / studentScores.length;
            stdDev = Math.sqrt(variance);
        }
    }

    const recalculatedStats = getRecalculatedItemStats(selectedSubject); //    修正 Bug   
    let fullScore = 0;
    let totalDiscrimination = 0;
    let questionCount = 0;

    // (计算小题满分)
    if (recalculatedStats.minorStats) {
        for (const qName in recalculatedStats.minorStats) {
            const stat = recalculatedStats.minorStats[qName];
            const qFull = stat.manualFullScore || stat.maxScore;
            if (qFull > 0) {
                fullScore += qFull;
            }
        }
    }

    // (计算平均区分度)
    const processDiscrimination = (statsObj) => {
        if (!statsObj) return;
        for (const qName in statsObj) {
            const stat = statsObj[qName];
            if (typeof stat.discrimination === 'number' && !isNaN(stat.discrimination)) {
                totalDiscrimination += stat.discrimination;
                questionCount++;
            }
        }
    };
    processDiscrimination(recalculatedStats.minorStats);
    processDiscrimination(recalculatedStats.majorStats);

    fullScore = parseFloat(fullScore.toFixed(1));
    const testDifficulty = (fullScore > 0) ? (avgTotal / fullScore) : 0;
    const avgDiscrimination = (questionCount > 0) ? (totalDiscrimination / questionCount) : 0;

    kpiContainer.innerHTML = `
        <div class="kpi-card"><h3>科目</h3><div class="value">${selectedSubject}</div></div>
        <div class="kpi-card"><h3>参考学生数</h3><div class="value">${validStudents.length}</div></div>
        <div class="kpi-card"><h3>平均分</h3><div class="value">${avgTotal.toFixed(2)}</div></div>
        <div class="kpi-card"><h3>最高分</h3><div class="value">${maxTotal}</div></div>
        <div class="kpi-card"><h3>最低分</h3><div class="value">${minTotal}</div></div>
        <div class="kpi-card"><h3>试卷满分 (小题和)</h3><div class="value">${fullScore}</div></div>
        <div class="kpi-card"><h3>整卷难度</h3><div class="value">${testDifficulty.toFixed(2)}</div></div>
        <div class="kpi-card"><h3>标准差</h3><div class="value">${stdDev.toFixed(2)}</div></div>
        <div class="kpi-card"><h3>平均区分度</h3><div class="value">${avgDiscrimination.toFixed(3)}</div></div>
        <div class="kpi-card"><h3>大题数量</h3><div class="value">${(data.majorQuestions || []).length}</div></div>
        <div class="kpi-card"><h3>小题数量</h3><div class="value">${(data.minorQuestions || []).length}</div></div>
    `;

    // 4.    NEW (Feature)    填充散点图的题目下拉框
    const scatterQSelect = document.getElementById('item-scatter-question-select');
    const qNamesMajor = data.majorQuestions || [];
    const qNamesMinor = data.minorQuestions || [];
    const allQNames = [...qNamesMajor, ...qNamesMinor]; // (大题在前)

    scatterQSelect.innerHTML = allQNames.map(qName => `<option value="${qName}">${qName}</option>`).join('');


    // 5. 延迟执行绘图 (不变)
    setTimeout(() => {
        drawItemAnalysisChart('major');
        drawItemAnalysisChart('minor');
        drawItemAnalysisLayeredChart();
        drawItemAnalysisLayeredMajorChart();
        drawItemAnalysisKnowledgeChart();
        drawItemAnalysisOutlierTable();
        drawItemScatterQuadrantChart(); //    NEW   
        drawItemKnowledgeGraph();
        drawLayerStudentTable();

        drawItemDifficultyPie();

        if (typeof initDiffCompareUI === 'function') {
            initDiffCompareUI();
        }
    }, 0);
}

/**
 * [修正版] 13.22. 绘制试卷难度结构饼图
 * 修复：只统计小题 (Minor)，防止叠加“客观题总分”等大题导致分值溢出
 */
function drawItemDifficultyPie() {
    const elementId = 'item-difficulty-pie-chart';
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    const subjectName = document.getElementById('item-subject-select').value;
    const recalculatedStats = getRecalculatedItemStats(subjectName);

    // 1. 统计各难度分值
    let scores = { easy: 0, medium: 0, hard: 0 };
    let totalFullScore = 0;

    const processStats = (statsObj) => {
        if (!statsObj) return;
        for (const qName in statsObj) {
            const stat = statsObj[qName];
            // 优先使用手动配置的满分，或者是自动识别的最大分
            const full = stat.manualFullScore || stat.maxScore || 0;
            
            // 使用修正后的难度 (P值: 数值越小越难)
            // 注意：这里我们统计的是“难度分布”，通常按得分率(difficulty)来划分
            // >= 0.75 容易
            // 0.45 - 0.75 中档
            // < 0.45 困难
            const diff = stat.difficulty; 

            if (full > 0) {
                totalFullScore += full;
                if (diff >= 0.75) scores.easy += full;      // 容易 (得分率高)
                else if (diff >= 0.45) scores.medium += full; // 中档
                else scores.hard += full;                   // 困难 (得分率低)
            }
        }
    };

    // ✅ 核心修复：只计算“小题”(Minor)，不计算“大题”(Major)
    // 因为大题通常是小题的汇总（如“选择题总分”），一起算会导致总分翻倍。
    processStats(recalculatedStats.minorStats);
    
    // ❌ [已删除] processStats(recalculatedStats.majorStats); 
    // 如果你的 Excel 里某些题没有小题号（比如只有“作文”没有题号），
    // 可以在配置里把它改成小题，或者在这里加个判断逻辑。
    // 但对于标准阅卷数据，只算 Minor 是最准确的。

    // 2. 准备数据
    const data = [
        { value: parseFloat(scores.easy.toFixed(1)), name: '容易 (≥0.75)', itemStyle: { color: '#28a745' } },
        { value: parseFloat(scores.medium.toFixed(1)), name: '中档 (0.45-0.75)', itemStyle: { color: '#007bff' } },
        { value: parseFloat(scores.hard.toFixed(1)), name: '困难 (<0.45)', itemStyle: { color: '#dc3545' } }
    ];

    // 3. 渲染
    const option = {
        title: {
            text: `总分: ${totalFullScore.toFixed(0)}分`, // 在标题里显示一下总分，方便核对
            left: 'center',
            top: 'center',
            textStyle: { fontSize: 14, color: '#666' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (p) => {
                return `<strong>${p.name}</strong><br/>分值: ${p.value}分<br/>占比: ${p.percent}%`;
            }
        },
        legend: { bottom: 0, left: 'center', itemWidth: 10, itemHeight: 10, textStyle:{fontSize:10} },
        series: [
            {
                name: '难度分布',
                type: 'pie',
                radius: ['40%', '65%'],
                center: ['50%', '45%'],
                avoidLabelOverlap: false,
                itemStyle: {
                    borderRadius: 5,
                    borderColor: '#fff',
                    borderWidth: 2
                },
                label: {
                    show: false,
                    position: 'center'
                },
                emphasis: {
                    label: {
                        show: true,
                        fontSize: 14,
                        fontWeight: 'bold',
                        formatter: '{b}\n{c}分 ({d}%)'
                    }
                },
                data: data
            }
        ]
    };

    myChart.setOption(option);
}


/**
 * 13.4. (ECharts) 渲染小题分析条形图 (带缩放)
 * *    修正版 3    - (此函数保持不变)
 * - (Bug 1)   加了对 qNames 的空值检查。
 * - (Bug 1) 修正了当 qNames.length 为 0 时，end 属性计算为 Infinity 的问题。
 */
function renderItemAnalysisBarChart(elementId, title, qNames, data, yAxisRange) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    //    修正    (Bug 1)
    if (!qNames || qNames.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">本科目无此类题目数据。</p>`;
        if (echartsInstances[elementId]) {
            echartsInstances[elementId].dispose();
        }
        return;
    }

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const endPercent = (qNames.length > 30) ? (30 / qNames.length * 100) : 100;

    const option = {
        title: {
            text: title,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const p = params[0];
                return `<strong>题号: ${p.name}</strong><br/>数值: ${p.value.toFixed(3)}`; //    修正错字
            }
        },
        grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
        xAxis: {
            type: 'category',
            data: qNames,
            name: '题号', //    修正错字
            axisLabel: {
                interval: 'auto',
                rotate: 30
            }
        },
        yAxis: {
            type: 'value',
            min: yAxisRange[0],
            max: yAxisRange[1]
        },
        dataZoom: [
            {
                type: 'slider',
                xAxisIndex: [0],
                start: 0,
                end: endPercent,
                bottom: 10,
                height: 20
            },
            {
                type: 'inside',
                xAxisIndex: [0]
            }
        ],
        series: [{
            name: title,
            type: 'bar',
            data: data,
            barWidth: '60%',
            itemStyle: {
                color: '#007bff'
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };

    echartsInstances[elementId].setOption(option);
}

// =====================================================================
//    NEW    模块十三：  功能函数 (Feature 2 & 3)
// =====================================================================

/**
 * 13.5.    (Feature 3) 
 * 获取重  计算后的统计数据 (应用了用户配置的满分)
 */
function getRecalculatedItemStats(subjectName) {
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return { minorStats: {}, majorStats: {}, minorQuestions: [], majorQuestions: [] };
    }

    // 1. 获取原始数据和配置
    const rawData = G_ItemAnalysisData[subjectName];
    const config = G_ItemAnalysisConfig[subjectName] || {};

    // 2. 创建  的统计对象
    const newMinorStats = {};
    const newMajorStats = {};

    // 3. 循环小题 (minor)
    (rawData.minorQuestions || []).forEach(qName => {
        const rawStat = rawData.minorStats[qName];
        if (!rawStat) return;

        const qConfig = config[qName] || {};

        //    核心    满分 = 手动配置的满分 || 自动检测的满分
        const fullScore = qConfig.fullScore || rawStat.maxScore;
        const avg = rawStat.avg;

        //    核心    重  计算难度
        const newDifficulty = (fullScore > 0) ? parseFloat((avg / fullScore).toFixed(2)) : 0;

        newMinorStats[qName] = {
            ...rawStat, // 复制原始数据 (avg, maxScore, discrimination)
            difficulty: newDifficulty, // 覆盖难度
            manualFullScore: qConfig.fullScore // 存储手动满分
        };
    });

    // 4. 循环大题 (major)
    (rawData.majorQuestions || []).forEach(qName => {
        const rawStat = rawData.majorStats[qName];
        if (!rawStat) return;

        const qConfig = config[qName] || {};
        const fullScore = qConfig.fullScore || rawStat.maxScore;
        const avg = rawStat.avg;
        const newDifficulty = (fullScore > 0) ? parseFloat((avg / fullScore).toFixed(2)) : 0;

        newMajorStats[qName] = {
            ...rawStat,
            difficulty: newDifficulty,
            manualFullScore: qConfig.fullScore
        };
    });

    return {
        minorStats: newMinorStats,
        majorStats: newMajorStats,
        minorQuestions: rawData.minorQuestions || [],
        majorQuestions: rawData.majorQuestions || []
    };
}

/**
 * 13.6.    (Feature 2) 
 * 绘制单个小题/大题图表 (根据下拉框选择)
 */
function drawItemAnalysisChart(type) { // type is 'minor' or 'major'
    const subjectName = document.getElementById('item-subject-select').value;
    if (!subjectName) return;

    // 1. 获取重  计算后的统计数据 (已应用配置)
    const stats = getRecalculatedItemStats(subjectName);

    // 2. 根据类型 (minor/major) 选择数据源
    const isMinor = (type === 'minor');
    const metricSelect = document.getElementById(isMinor ? 'item-minor-metric-select' : 'item-major-metric-select');
    const chartId = isMinor ? 'item-chart-minor' : 'item-chart-major';

    const qNames = isMinor ? stats.minorQuestions : stats.majorQuestions;
    const statsData = isMinor ? stats.minorStats : stats.majorStats;

    // 3. 根据下拉框选择指标
    const metric = metricSelect.value; // 'difficulty' or 'discrimination'

    // 4. 提取数据
    const data = qNames.map(qName => {
        return (statsData[qName] && statsData[qName][metric] !== undefined) ? statsData[qName][metric] : 0;
    });

    // 5. 准备图表参数
    let title, yAxisRange;
    if (metric === 'difficulty') {
        title = `各${isMinor ? '小' : '大'}题难度 (得分率)`;
        yAxisRange = [0, 1];
    } else {
        title = `各${isMinor ? '小' : '大'}题区分度`;
        yAxisRange = [-0.2, 1];
    }

    // 6. 渲染图表
    renderItemAnalysisBarChart(chartId, title, qNames, data, yAxisRange);
}

/**
 * 13.7. [增强版] 填充配置弹窗 (支持难度系数 + 试卷文本回显)
 */
function populateItemAnalysisConfigModal() {
    const subjectName = document.getElementById('item-subject-select').value;
    if (!subjectName) { alert("无可用科目！"); return; }

    const rawData = G_ItemAnalysisData[subjectName];
    const subjectConfig = G_ItemAnalysisConfig[subjectName] || {};
    const recalculatedStats = getRecalculatedItemStats(subjectName);

    const tableBody = document.getElementById('item-config-table-body');
    const paperTextarea = document.getElementById('item-config-full-paper'); 

    // 回显设置
    const skipRowsInput = document.getElementById('item-config-skip-rows');
    const globalSettings = G_ItemAnalysisConfig._global_settings_ || {};
    skipRowsInput.value = globalSettings.rowsToSkip !== undefined ? globalSettings.rowsToSkip : 3;

    paperTextarea.value = subjectConfig['_full_paper_context_'] || "";
    const graphDefTextarea = document.getElementById('item-config-graph-def');
    graphDefTextarea.value = subjectConfig['_knowledge_graph_def_'] || "";

    let html = '';
    const createRow = (qName, type, stat) => {
        if (!stat) return '';
        const qConfig = subjectConfig[qName] || {};
        const autoFull = stat.maxScore;
        const manualFull = qConfig.fullScore || '';
        const content = qConfig.content || '';
        
        // ✅【新增】读取已保存的难度
        const difficulty = qConfig.manualDifficulty !== undefined ? qConfig.manualDifficulty : '';

        return `
            <tr data-q-name="${qName}">
                <td><strong>${qName}</strong> (${type})</td>
                <td><input type="number" class="item-config-full" placeholder="自动: ${autoFull}" value="${manualFull}" style="width: 80px;"></td>
                
                <td>
                    <input type="number" class="item-config-diff" placeholder="0.0-1.0" value="${difficulty}" step="0.01" min="0" max="1" style="width: 80px; border: 1px solid #d35400; color: #d35400; font-weight: bold;">
                </td>

                <td><input type="text" class="item-config-content" value="${content}" style="width: 100%;"></td>
            </tr>
        `;
    };

    (recalculatedStats.majorQuestions || []).forEach(qName => { html += createRow(qName, '大题', recalculatedStats.majorStats[qName]); });
    (recalculatedStats.minorQuestions || []).forEach(qName => { html += createRow(qName, '小题', recalculatedStats.minorStats[qName]); });

    tableBody.innerHTML = html;

    const modal = document.getElementById('item-analysis-config-modal');
    document.getElementById('item-config-modal-title').innerText = `配置题目详情 (科目: ${subjectName})`;
    modal.dataset.subjectName = subjectName;
    modal.style.display = 'flex';
}

/**
 * 13.8. [增强版] 保存配置弹窗 (保存难度系数)
 */
function saveItemAnalysisConfigFromModal() {
    const modal = document.getElementById('item-analysis-config-modal');
    const subjectName = modal.dataset.subjectName;
    if (!subjectName) return;

    let allConfigs = G_ItemAnalysisConfig;

    const oldSkipRows = allConfigs._global_settings_ ? allConfigs._global_settings_.rowsToSkip : 3;
    const skipRowsInput = document.getElementById('item-config-skip-rows').value;
    const newSkipRows = parseInt(skipRowsInput);

    allConfigs._global_settings_ = allConfigs._global_settings_ || {};
    allConfigs._global_settings_.rowsToSkip = isNaN(newSkipRows) ? 3 : newSkipRows;

    let subjectConfig = allConfigs[subjectName] || {};

    const fullPaperText = document.getElementById('item-config-full-paper').value;
    subjectConfig['_full_paper_context_'] = fullPaperText;

    const graphDefText = document.getElementById('item-config-graph-def').value;
    subjectConfig['_knowledge_graph_def_'] = graphDefText;

    // ✅【新增】保存难度逻辑
    const rows = document.getElementById('item-config-table-body').querySelectorAll('tr');
    rows.forEach(row => {
        const qName = row.dataset.qName;
        const manualFullInput = row.querySelector('.item-config-full').value;
        const contentInput = row.querySelector('.item-config-content').value;
        
        // 获取难度输入
        const diffInput = row.querySelector('.item-config-diff').value;
        
        const manualFull = parseFloat(manualFullInput);
        const manualDiff = parseFloat(diffInput);

        subjectConfig[qName] = {
            fullScore: (!isNaN(manualFull) && manualFull > 0) ? manualFull : undefined,
            content: contentInput || undefined,
            // 保存难度 (如果是有效数字)
            manualDifficulty: (!isNaN(manualDiff)) ? manualDiff : undefined
        };
    });

    allConfigs[subjectName] = subjectConfig;
    G_ItemAnalysisConfig = allConfigs;

    localforage.setItem('G_ItemAnalysisConfig', allConfigs).then(() => {
        modal.style.display = 'none';
        renderItemAnalysisCharts(); 

        if (oldSkipRows !== allConfigs._global_settings_.rowsToSkip) {
            alert(`✅ 配置已保存！\n\n⚠️ 检测到您修改了“末尾跳过行数”...\n请务必【重新导入】Excel 文件！`);
        } else {
            alert("✅ 配置已保存！(难度系数已更新)");
        }
    });
}

// =====================================================================
//    NEW    模块十三：分层对比图 (Feature 4)
// =====================================================================

/**
 * 13.9. [MODIFIED] (Feature 4) 
 * 计算分层后的小题统计数据
 * *    修正版 12    - 2025-11-11
 * - (Bug 修复) 修正了 groupStats (层均分) 只计算了小题，未计算大题的问题。
 * - (Bug 修复) 这导致了学生详情表中大题的 "层均得分率" 和 "偏差" 显示为 NaN。
 */
function calculateLayeredItemStats(subjectName, numGroups, filteredStudents) {
    // 1. 获取原始学生数据 (已在外部筛选)
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return { groupStats: {}, qNames: [], overallDifficulty: {} };
    }
    const rawData = G_ItemAnalysisData[subjectName];

    //    修正    "qNames" 仅用于小题图表X轴，保持不变
    const qNames = rawData.minorQuestions || [];

    // 2. 获取重  计算后的 "满分" 配置
    const recalculatedStats = getRecalculatedItemStats(subjectName);
    const overallDifficulty = {}; // (用于柱状图)

    // 3. 获取有效学生并按总分排序 (高 -> 低)
    const validStudents = (filteredStudents || [])
        .filter(s => typeof s.totalScore === 'number' && !isNaN(s.totalScore))
        .sort((a, b) => b.totalScore - a.totalScore);

    if (validStudents.length === 0) {
        return { groupStats: {}, qNames: qNames, overallDifficulty: {} };
    }

    // 4. 将学生分层 (G1, G2, ...)
    const groupSize = Math.ceil(validStudents.length / numGroups);
    const studentGroups = [];
    for (let i = 0; i < numGroups; i++) {
        const group = validStudents.slice(i * groupSize, (i + 1) * groupSize);
        if (group.length > 0) {
            studentGroups.push(group);
        }
    }

    // 5.    修正    (Bug 修复) 计算 *所有* 题目的层均分
    const groupStats = {};

    // (辅助函数)
    const calculateGroupRates = (qNameList, scoreType, statsType) => {
        if (!qNameList || qNameList.length === 0) return;

        qNameList.forEach(qName => {
            // (a) 获取该题的 "正确" 满分
            const stat = recalculatedStats[statsType][qName];
            if (!stat) return;

            const fullScore = stat.manualFullScore || stat.maxScore;

            if (!fullScore || fullScore === 0) {
                //    关键修复点    如果满分为0，则该题的平均得分率也必须为0，不能中断循环
                studentGroups.forEach((_, index) => {
                    const groupName = `G${index + 1}`;
                    if (!groupStats[groupName]) groupStats[groupName] = {};
                    groupStats[groupName][qName] = 0; // 确保设置为0
                });
                return;
            }

            // (b) 遍历所有层，计算该题在该层的平均得分率
            studentGroups.forEach((group, index) => {
                const groupName = `G${index + 1}`;
                if (!groupStats[groupName]) groupStats[groupName] = {};

                let totalScore = 0;
                let validCount = 0;
                group.forEach(student => {
                    const score = student[scoreType][qName]; // 'minorScores' or 'majorScores'
                    if (typeof score === 'number' && !isNaN(score)) {
                        totalScore += score;
                        validCount++;
                    }
                });
                const avgScore = (validCount > 0) ? totalScore / validCount : 0;
                const difficulty = parseFloat((avgScore / fullScore).toFixed(3));
                groupStats[groupName][qName] = difficulty;
            });
        });
    };

    //    修正    (Bug 修复) 同时计算小题和大题
    calculateGroupRates(rawData.minorQuestions, 'minorScores', 'minorStats');
    calculateGroupRates(rawData.majorQuestions, 'majorScores', 'majorStats');

    // 6.    不变    (Bug 修复)
    // "overallDifficulty" 仅用于小题对比图的柱状图，所以 *只* 计算小题
    qNames.forEach(qName => {
        overallDifficulty[qName] = recalculatedStats.minorStats[qName]?.difficulty || 0;
    });

    return { groupStats, qNames, overallDifficulty };
}

/**
 * 13.10. [MODIFIED] (Feature 4) 
 * 绘制小题得分率分层对比图
 * *    修正版 11    - 2025-11-11
 * - (Bug 修复) 在 setOption 时添加 { notMerge: true }，解决折线图不显示的 Bug。
 */
function drawItemAnalysisLayeredChart() {
    const chartDom = document.getElementById('item-chart-layered');
    if (!chartDom) return;

    if (echartsInstances['item-chart-layered']) {
        echartsInstances['item-chart-layered'].dispose();
    }
    echartsInstances['item-chart-layered'] = echarts.init(chartDom);

    // 1. 获取参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);

    // 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. [核心] 计算分层数据 (现在会返回正确的 overallDifficulty)
    const { groupStats, qNames, overallDifficulty } = calculateLayeredItemStats(subjectName, numGroups, filteredStudents);

    if (qNames.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">本科目无“小题”数据，无法生成分层图。</p>`;
        return;
    }

    // 4. 准备 ECharts Series (不变)
    const series = [];
    const legendData = [];

    series.push({
        name: '全体得分率',
        type: 'bar',
        data: qNames.map(qName => overallDifficulty[qName]),
        barWidth: '60%',
        itemStyle: { opacity: 0.6, color: '#909399' },
        z: 3
    });
    legendData.push('全体得分率');

    const lineColors = [
        '#007bff', '#28a745', '#17a2b8', '#ffc107', '#fd7e14',
        '#6f42c1', '#dc3545', '#e83e8c', '#6c757d', '#343a40'
    ];

    Object.keys(groupStats).forEach((groupName, index) => {
        legendData.push(groupName);
        series.push({
            name: groupName,
            type: 'line',
            smooth: true,
            data: qNames.map(qName => groupStats[groupName][qName] || 0),
            color: lineColors[index % lineColors.length],
            z: 10
        });
    });

    // 5. ECharts 配置 (不变)
    const option = {
        title: {
            text: '小题得分率分层对比',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { data: legendData, top: 30, type: 'scroll' },
        grid: { left: '3%', right: '4%', bottom: '20%', top: 70, containLabel: true },
        xAxis: {
            type: 'category',
            data: qNames,
            name: '小题题号',
            axisLabel: { interval: 'auto', rotate: 30 }
        },
        yAxis: { type: 'value', name: '得分率', min: 0, max: 1 },
        dataZoom: [
            {
                type: 'slider',
                xAxisIndex: [0],
                start: 0,
                end: (qNames.length > 30) ? (30 / qNames.length * 100) : 100,
                bottom: 10,
                height: 20
            },
            {
                type: 'inside',
                xAxisIndex: [0]
            }
        ],
        series: series
    };

    //    修正    (Bug 修复) 添加 notMerge: true
    echartsInstances['item-chart-layered'].setOption(option, { notMerge: true });
}

// =====================================================================
//    NEW    模块十三：知识点分层图 (Feature 5)
// =====================================================================

/**
 * 13.11. [FIXED & UPGRADED] 计算分层后的知识点统计数据
 *        ：统计每个知识点对应的题目题号
 */
function calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents, questionType = 'all') {
    // 1. 获取基础数据
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return { groupStats: {}, knowledgePoints: [], studentsWithRates: [], displayLabels: [] };
    }
    const rawData = G_ItemAnalysisData[subjectName];
    const subjectConfig = G_ItemAnalysisConfig[subjectName] || {};

    // 2. [核心] 构建知识点列表 & 题目映射关系
    const knowledgeSet = new Set();
    const kpToQuestionsMap = {}; // { "牛顿定律": ["1", "3"], "速度": ["4"] }

    // 辅助：收集题号到知识点的映射
    const collectQuestionInfo = (qList) => {
        if (!qList) return;
        qList.forEach(qName => {
            const content = subjectConfig[qName]?.content;
            if (content) {
                // 支持中文分号和英文分号
                const kps = content.split(/[;；]/).map(k => k.trim()).filter(k => k);
                kps.forEach(k => {
                    knowledgeSet.add(k);
                    
                    if (!kpToQuestionsMap[k]) kpToQuestionsMap[k] = [];
                    // 避免重复添加 (虽然逻辑上不会，但为了保险)
                    if (!kpToQuestionsMap[k].includes(qName)) {
                        kpToQuestionsMap[k].push(qName);
                    }
                });
            }
        });
    };

    // 根据筛选类型收集题目信息
    if (questionType === 'all' || questionType === 'minor') collectQuestionInfo(rawData.minorQuestions);
    if (questionType === 'all' || questionType === 'major') collectQuestionInfo(rawData.majorQuestions);

    const knowledgePoints = Array.from(knowledgeSet).sort();

    //            生成用于图表显示的标签数组 (与 knowledgePoints 一一对应)
    const displayLabels = knowledgePoints.map(kp => {
        const qList = kpToQuestionsMap[kp] || [];
        // 对题号进行简单排序 (数字排序)
        qList.sort((a, b) => {
            const numA = parseFloat(a) || 0;
            const numB = parseFloat(b) || 0;
            return numA - numB;
        });
        
        // 如果题目太多，换行显示，避免挤在一起
        const qStr = qList.join(',');
        return `${kp}\n(题${qStr})`; // 例如：速度\n(题4,12)
    });

    if (knowledgePoints.length === 0) {
        return { groupStats: {}, knowledgePoints: [], studentsWithRates: [], displayLabels: [] };
    }

    // 3. 获取重  计算后的满分
    const recalculatedStats = getRecalculatedItemStats(subjectName);

    // 4. 获取排序后的学生
    const validStudents = (filteredStudents || [])
        .filter(s => typeof s.totalScore === 'number' && !isNaN(s.totalScore))
        .sort((a, b) => b.totalScore - a.totalScore);

    if (validStudents.length === 0) {
        return { groupStats: {}, knowledgePoints: knowledgePoints, studentsWithRates: [], displayLabels: displayLabels };
    }

    // 5. 计算每个学生在每个知识点上的得分率
    validStudents.forEach(student => {
        student.knowledgeRates = {};
        const aggregates = {};
        knowledgePoints.forEach(kp => { aggregates[kp] = { totalGot: 0, totalPossible: 0 }; });

        const processQuestion = (qName, statsType, scoreType) => {
            const qContent = subjectConfig[qName]?.content || "";
            const qKps = qContent.split(/[;；]/).map(k => k.trim()).filter(k => k);

            if (qKps.length > 0) {
                const stat = recalculatedStats[statsType][qName];
                const score = student[scoreType][qName];
                const fullScore = stat?.manualFullScore || stat?.maxScore;

                if (typeof score === 'number' && !isNaN(score) && fullScore > 0) {
                    qKps.forEach(targetKp => {
                        if (aggregates[targetKp]) {
                            aggregates[targetKp].totalGot += score;
                            aggregates[targetKp].totalPossible += fullScore;
                        }
                    });
                }
            }
        };

        if (questionType === 'all' || questionType === 'minor') {
            (rawData.minorQuestions || []).forEach(qName => processQuestion(qName, 'minorStats', 'minorScores'));
        }
        if (questionType === 'all' || questionType === 'major') {
            (rawData.majorQuestions || []).forEach(qName => processQuestion(qName, 'majorStats', 'majorScores'));
        }

        for (const kp in aggregates) {
            const agg = aggregates[kp];
            student.knowledgeRates[kp] = (agg.totalPossible > 0) ? (agg.totalGot / agg.totalPossible) : null;
        }
    });

    // 6. 将学生分层
    const groupSize = Math.ceil(validStudents.length / numGroups);
    const studentGroups = [];
    for (let i = 0; i < numGroups; i++) {
        const group = validStudents.slice(i * groupSize, (i + 1) * groupSize);
        if (group.length > 0) studentGroups.push(group);
    }

    // 7. 计算每层平均得分率
    const groupStats = {};
    studentGroups.forEach((group, index) => {
        const groupName = `G${index + 1}`;
        groupStats[groupName] = {};
        knowledgePoints.forEach(kp => {
            let totalRate = 0;
            let validCount = 0;
            group.forEach(student => {
                const rate = student.knowledgeRates[kp];
                if (rate !== null && !isNaN(rate)) {
                    totalRate += rate;
                    validCount++;
                }
            });
            groupStats[groupName][kp] = (validCount > 0) ? (totalRate / validCount) : 0;
        });
    });

    //    修改    返回 displayLabels
    return { groupStats, knowledgePoints, studentsWithRates: validStudents, displayLabels };
}


/**
 * 13.12. [MODIFIED] (Feature 5) 
 * 绘制知识点掌握情况分组柱状图
 */
function drawItemAnalysisKnowledgeChart() {
    const chartDom = document.getElementById('item-chart-knowledge');
    if (!chartDom) return;

    if (echartsInstances['item-chart-knowledge']) {
        echartsInstances['item-chart-knowledge'].dispose();
    }
    echartsInstances['item-chart-knowledge'] = echarts.init(chartDom);

    // 1. 获取参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);

    // 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. [核心] 计算分层数据
    //    解构出 displayLabels
    const { groupStats, knowledgePoints, displayLabels } = calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents);

    if (knowledgePoints.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">未找到已配置“考查内容”的题目，请先点击“配置题目”。</p>`;
        return;
    }

    // 4. 准备 ECharts Series
    const series = [];
    const legendData = Object.keys(groupStats);
    const lineColors = [
        '#007bff', '#28a745', '#17a2b8', '#ffc107', '#fd7e14',
        '#6f42c1', '#dc3545', '#e83e8c', '#6c757d', '#343a40'
    ];

    legendData.forEach((groupName, index) => {
        series.push({
            name: groupName,
            type: 'bar',
            barGap: 0,
            emphasis: { focus: 'series' },
            // 数据依然使用 knowledgePoints (原始key) 来索引 groupStats
            data: knowledgePoints.map(kp => {
                return parseFloat((groupStats[groupName][kp] || 0).toFixed(3));
            }),
            color: lineColors[index % lineColors.length]
        });
    });

    // 5. ECharts 配置
    const option = {
        title: {
            text: '知识点掌握情况 (按总分分层)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: { 
            trigger: 'axis', 
            axisPointer: { type: 'shadow' },
            // [可选] Tooltip 格式化，让浮层也显示题目
            formatter: (params) => {
                // params[0].name 已经是带换行符的 displayLabel 了
                // 我们可以把它处理一下，让它在 tooltip 里显示得更好看
                const title = params[0].name.replace('\n', ' '); 
                let html = `<strong>${title}</strong><br/>`;
                params.forEach(p => {
                    html += `${p.marker} ${p.seriesName}: ${p.value}<br/>`;
                });
                return html;
            }
        },
        legend: { data: legendData, top: 30, type: 'scroll' },
        grid: { left: '3%', right: '4%', bottom: '20%', top: 70, containLabel: true },
        xAxis: {
            type: 'category',
            //    核心修改    这里使用 displayLabels 而不是 knowledgePoints
            data: displayLabels, 
            name: '知识点 (含题号)',
            axisLabel: { 
                interval: 0, // 强制显示所有标签
                rotate: 30,  // 旋转以防重叠
                fontSize: 11,
                // 如果标签太长，ECharts 会自动处理换行，因为我们加了 \n
                lineHeight: 14 
            }
        },
        yAxis: { type: 'value', name: '得分率', min: 0, max: 1 },
        dataZoom: [
            {
                type: 'slider',
                xAxisIndex: [0],
                start: 0,
                // 动态调整显示范围，防止柱子太细
                end: (knowledgePoints.length > 15) ? (15 / knowledgePoints.length * 100) : 100,
                bottom: 10,
                height: 20
            },
            {
                type: 'inside',
                xAxisIndex: [0]
            }
        ],
        series: series
    };

    echartsInstances['item-chart-knowledge'].setOption(option, { notMerge: true });
}

// =====================================================================
//    NEW    模块十三：学生个体诊断表 (Feature 6)
// =====================================================================

/**
 * 13.13. [MODIFIED] (Feature 6) 
 * 计算学生知识点偏差（短板/亮点）
 * *    修正版 12    - 2025-11-11
 * - (Feature) 签名变更，接收 studentsWithRates。
 * - (Refactor) 移除了重复的学生获取和得分率计算。
 */
function calculateStudentKnowledgeOutliers(subjectName, numGroups, groupStats, knowledgePoints, studentsWithRates, questionType = 'all') {
    // 1. 获取基础数据 (已在外部筛选)
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return [];
    }

    // 2.    修正    (Refactor) 直接使用传入的 studentsWithRates
    const validStudents = studentsWithRates;

    if (validStudents.length === 0 || knowledgePoints.length === 0) {
        return [];
    }

    // (健壮性检查)
    if (!validStudents[0] || !validStudents[0].knowledgeRates) {
        console.error("calculateStudentKnowledgeOutliers: 依赖的学生知识点得分率未计算。");
        return [];
    }

    // 3. 将学生分层 (G1, G2, ...)
    const groupSize = Math.ceil(validStudents.length / numGroups);
    const outlierList = [];

    for (let i = 0; i < validStudents.length; i++) {
        const student = validStudents[i];

        // (a) 确定学生所在的层
        const groupIndex = Math.floor(i / groupSize);
        const groupName = `G${groupIndex + 1}`;
        const layerAverages = groupStats[groupName];

        if (!layerAverages) continue;

        let worstDeviation = 0;
        let worstKP = 'N/A';
        let bestDeviation = 0;
        let bestKP = 'N/A';

        // (b) 遍历所有知识点，计算偏差
        knowledgePoints.forEach(kp => {
            const studentRate = student.knowledgeRates[kp];
            const layerRate = layerAverages[kp];

            //    修正    只有当学生和层级都有有效得分率时才比较
            if (studentRate !== null && typeof studentRate === 'number' && typeof layerRate === 'number' && layerRate > 0) {
                const deviation = studentRate - layerRate;

                if (deviation < worstDeviation) {
                    worstDeviation = deviation;
                    worstKP = kp;
                }
                if (deviation > bestDeviation) {
                    bestDeviation = deviation;
                    bestKP = kp;
                }
            }
        });

        // (c) 存入列表
        outlierList.push({
            name: student.name,
            id: student.id,
            totalScore: student.totalScore,
            layer: groupName,
            worstKP: worstKP,
            worstDeviation: worstDeviation,
            bestKP: bestKP,
            bestDeviation: bestDeviation
        });
    }

    return outlierList;
}
/**
 * 13.14. [MODIFIED] (Feature 6) 
 * 绘制学生个体知识点诊断表
 * *    修正版 12    - 2025-11-11
 * - (Feature)     读取 "题目类型" (questionType) 筛选器。
 * - (Feature) 将 questionType 传递给计算函数。
 */
function drawItemAnalysisOutlierTable() {
    const tableContainer = document.getElementById('item-outlier-table-container');
    if (!tableContainer) return;

    const detailContainer = document.getElementById('item-student-detail-container');
    if (detailContainer) detailContainer.style.display = 'none';

    //         (One Button)    重置打印按钮
    const printBtn = document.getElementById('item-print-btn');
    if (printBtn) {
        // (获取当前筛选的文本)
        const classFilterSelect = document.getElementById('item-class-filter');
        const classFilterText = classFilterSelect.value === 'ALL' ? '全体' : classFilterSelect.options[classFilterSelect.selectedIndex].text;

        printBtn.innerText = `🖨️ 打印当前筛选 (${classFilterText})`;
        printBtn.dataset.printTarget = 'filter'; // 设为"筛选"模式
        printBtn.dataset.studentId = ''; // 清空学生ID
    }

    // 1. 获取参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);
    const sortType = document.getElementById('item-outlier-sort').value;
    const searchQuery = document.getElementById('item-outlier-search').value.toLowerCase();
    const questionType = document.getElementById('item-outlier-type-filter').value; //    NEW   

    // 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. [核心] 先调用知识点分层统计
    //    修正    传递 questionType
    const { groupStats, knowledgePoints, studentsWithRates } = calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents, questionType);

    if (knowledgePoints.length === 0) {
        tableContainer.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 20px;">未找到已配置“考察内容”的题目，无法生成诊断表。</p>`;
        G_ItemOutlierList = [];
        return;
    }

    // 4. [核心] 再调用偏差计算
    //    修正    传递 questionType 和 studentsWithRates
    G_ItemOutlierList = calculateStudentKnowledgeOutliers(subjectName, numGroups, groupStats, knowledgePoints, studentsWithRates, questionType);

    // 5. 根据搜索框过滤
    const searchedList = (searchQuery)
        ? G_ItemOutlierList.filter(s =>
            s.name.toLowerCase().includes(searchQuery) ||
            String(s.id).toLowerCase().includes(searchQuery)
        )
        : G_ItemOutlierList;

    // 6. 根据下拉框排序
    if (sortType === 'weakness') {
        searchedList.sort((a, b) => a.worstDeviation - b.worstDeviation);
    } else {
        searchedList.sort((a, b) => b.bestDeviation - a.bestDeviation);
    }

    // 7. 渲染表格 HTML (不变)
    let html = ``;
    if (searchedList.length === 0) {
        html = `<p style="text-align: center; color: var(--text-muted); padding: 20px;">未找到符合条件的学生。</p>`;
    } else {
        html = `
            <table>
                <thead>
                    <tr>
                        <th>姓名</th>
                        <th>层级</th>
                        <th>总分</th>
                        <th>最大短板 (知识点)</th>
                        <th>短板偏差</th>
                        <th>最大亮点 (知识点)</th>
                        <th>亮点偏差</th>
                    </tr>
                </thead>
                <tbody>
                    ${searchedList.map(s => `
                        <tr data-id="${s.id}" data-name="${s.name}" data-layer="${s.layer}" style="cursor: pointer;">
                            <td>${s.name}</td>
                            <td><strong>${s.layer}</strong></td>
                            <td>${s.totalScore}</td>
                            
                            <td>${s.worstKP}</td>
                            <td>
                                ${s.worstDeviation < 0
                ? `<strong class="regress">▼ ${s.worstDeviation.toFixed(2)}</strong>`
                : s.worstDeviation.toFixed(2)
            }
                            </td>
                            
                            <td>${s.bestKP}</td>
                            <td>
                                ${s.bestDeviation > 0
                ? `<strong class="progress">▲ ${s.bestDeviation.toFixed(2)}</strong>`
                : s.bestDeviation.toFixed(2)
            }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    tableContainer.innerHTML = html;
}

// =====================================================================
//    NEW    模块十三：班级筛选辅助函数 (Feature 1)
// =====================================================================

/**
 * 13.15.    (Feature 1) 
 * 填充模块十三的班级筛选器
 */
function populateItemClassFilter(allStudents) {
    const classFilterSelect = document.getElementById('item-class-filter');
    if (!classFilterSelect) return;

    // 1. 获取当前选中的值 (以便在刷  时保留)
    const oldValue = classFilterSelect.value;

    // 2. 从学生列表中提取班级
    const classes = [...new Set(allStudents.map(s => s.class))].sort();

    // 3. 生成 HTML
    let html = `<option value="ALL">-- 全体 --</option>`;
    html += classes.map(c => `<option value="${c}">${c}</option>`).join('');

    classFilterSelect.innerHTML = html;

    // 4. 尝试恢复旧值
    if (oldValue && classFilterSelect.querySelector(`option[value="${oldValue}"]`)) {
        classFilterSelect.value = oldValue;
    } else {
        classFilterSelect.value = 'ALL';
    }
}

// =====================================================================
//    NEW    模块十三：学生个体-题目详情表 (Feature 7)
// =====================================================================

/**
 * 13.16. [MODIFIED] (Feature 7) 
 * 绘制学生个体-题目详情表
 * *    修正版 14    - 2025-11-11
 * - (Feature) 应用 G_ItemDetailSort 排序。
 * - (Feature) 渲染 <th> 上的 data-sort-key 属性和排序样式类。
 * - (Bug 修复保持) 确保了对 calculateLayeredItemStats 的正确调用。
 */
function drawItemStudentDetailTable(studentId, studentName, studentLayer, questionType = 'all') {
    const detailContainer = document.getElementById('item-student-detail-container');
    if (!detailContainer) return;

    // 1. 获取参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);

    // 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. 获取学生对象
    const student = filteredStudents.find(s => String(s.id) === String(studentId));
    if (!student) {
        detailContainer.innerHTML = `<p>未找到学生 ${studentName} 的数据。</p>`;
        return;
    }

    // 4. (不变) 获取层均分
    const { groupStats } = calculateLayeredItemStats(subjectName, numGroups, filteredStudents);
    const layerAvgRates = groupStats[studentLayer];

    // 5. (不变) 获取题目满分
    const recalculatedStats = getRecalculatedItemStats(subjectName);
    const { minorStats, majorStats, minorQuestions, majorQuestions } = recalculatedStats;

    if (!layerAvgRates) {
        detailContainer.innerHTML = `<p>无法计算 ${studentLayer} 的层级平均数据。</p>`;
        return;
    }

    // 6. (不变) 遍历所有题目，计算偏差
    const allQuestionDetails = [];
    const processQuestion = (qName, stat, studentScore) => {
        if (!stat) return;
        const fullScore = stat.manualFullScore || stat.maxScore;
        const studentRate = (fullScore > 0 && typeof studentScore === 'number') ? (studentScore / fullScore) : null;
        const layerRate = layerAvgRates[qName];
        const deviation = (studentRate !== null && typeof layerRate === 'number') ? (studentRate - layerRate) : null;
        const kp = (G_ItemAnalysisConfig[subjectName] && G_ItemAnalysisConfig[subjectName][qName]) ? G_ItemAnalysisConfig[subjectName][qName].content : '';
        const studentOutlierData = G_ItemOutlierList.find(s => String(s.id) === String(studentId));
        const worstKP = studentOutlierData ? studentOutlierData.worstKP : null;
        const bestKP = studentOutlierData ? studentOutlierData.bestKP : null;
        let kpClass = '';
        if (kp && kp === worstKP) kpClass = 'regress';
        if (kp && kp === bestKP) kpClass = 'progress';

        allQuestionDetails.push({
            qName: qName,
            kp: kp || 'N/A', //    修正    确保N/A
            studentScore: studentScore ?? 'N/A',
            fullScore: fullScore,
            studentRate: studentRate,
            layerRate: layerRate,
            deviation: deviation,
            kpClass: kpClass
        });
    };
    if (questionType === 'all' || questionType === 'minor') {
        (minorQuestions || []).forEach(qName => {
            processQuestion(qName, minorStats[qName], student.minorScores[qName]);
        });
    }
    if (questionType === 'all' || questionType === 'major') {
        (majorQuestions || []).forEach(qName => {
            processQuestion(qName, majorStats[qName], student.majorScores[qName]);
        });
    }

    // 7.    修正 (Feature)    按 G_ItemDetailSort 排序
    allQuestionDetails.sort((a, b) => {
        const { key, direction } = G_ItemDetailSort;
        let valA = a[key];
        let valB = b[key];

        // 处理 'N/A' 和 null
        if (valA === 'N/A' || valA === null || valA === undefined) valA = (direction === 'asc' ? Infinity : -Infinity);
        if (valB === 'N/A' || valB === null || valB === undefined) valB = (direction === 'asc' ? Infinity : -Infinity);

        if (key === 'qName' || key === 'kp') {
            // 字符串排序
            return direction === 'asc'
                ? String(valA).localeCompare(String(valB))
                : String(valB).localeCompare(String(valA));
        } else {
            // 数字排序
            return direction === 'asc' ? valA - valB : valB - valA;
        }
    });

    // 8. 渲染表格
    const typeText = (questionType === 'minor') ? ' (仅小题)' : (questionType === 'major') ? ' (仅大题)' : ' (全部题目)';
    detailContainer.innerHTML = `
        <h4>${studentName} (${studentLayer}层) - 题目详情${typeText} (按短板排序)</h4>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
            <table>
                <thead>
                    <tr>
                        <th data-sort-key="qName">题号</th>
                        <th data-sort-key="kp">知识点</th>
                        <th data-sort-key="studentScore">学生得分</th>
                        <th data-sort-key="fullScore">满分</th>
                        <th data-sort-key="studentRate">学生得分率</th>
                        <th data-sort-key="layerRate">层均得分率</th>
                        <th data-sort-key="deviation">得分率偏差</th>
                    </tr>
                </thead>
                <tbody>
                    ${allQuestionDetails.map(q => `
                        <tr>
                            <td><strong>${q.qName}</strong></td>
                            <td class="${q.kpClass}">
                                <strong>${q.kp}</strong>
                            </td>
                            <td>${q.studentScore}</td>
                            <td>${q.fullScore}</td>
                            <td>${q.studentRate !== null ? (q.studentRate * 100).toFixed(1) + '%' : 'N/A'}</td>
                            <td>${(q.layerRate !== null && q.layerRate !== undefined) ? (q.layerRate * 100).toFixed(1) + '%' : 'N/A'}</td>
                            <td>
                                ${(q.deviation !== null && q.deviation !== undefined)
            ? (q.deviation > 0
                ? `<strong class="progress">▲ ${(q.deviation * 100).toFixed(1)}%</strong>`
                : (q.deviation < 0
                    ? `<strong class="regress">▼ ${(q.deviation * 100).toFixed(1)}%</strong>`
                    : `0.0%`))
            : 'N/A'
        }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    // 9.    NEW (Feature)    应用排序样式
    const th = detailContainer.querySelector(`th[data-sort-key="${G_ItemDetailSort.key}"]`);
    if (th) {
        th.classList.add(G_ItemDetailSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    // 10. (显示)
    detailContainer.style.display = 'block';

    //    在这里添加第 3 个代码片段
    // 11.    修改 (One Button)    更  打印按钮状态
    const printBtn = document.getElementById('item-print-btn');
    if (printBtn) {
        printBtn.innerText = `🖨️ 打印 ${studentName}`;
        printBtn.dataset.printTarget = 'current'; // 设为"当前"模式
        printBtn.dataset.studentId = studentId; // 存储ID
    }
}

// =====================================================================
//    NEW    模块十三：题目-学生 四象限图 (Feature 8)
// =====================================================================

/**
 * 13.17.    (Feature 8) 
 * 绘制 题目-学生 诊断散点图 (四象限图)
 */
function drawItemScatterQuadrantChart() {
    const chartDom = document.getElementById('item-chart-scatter-quadrant');
    if (!chartDom) return;

    if (echartsInstances['item-chart-scatter-quadrant']) {
        echartsInstances['item-chart-scatter-quadrant'].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances['item-chart-scatter-quadrant'] = myChart;

    // 1. 获取参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const qName = document.getElementById('item-scatter-question-select').value;

    if (!qName) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">请选择一道题目。</p>`;
        return;
    }

    // 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. 获取题目统计数据
    const recalculatedStats = getRecalculatedItemStats(subjectName);
    const stat = recalculatedStats.minorStats[qName] || recalculatedStats.majorStats[qName];
    if (!stat) {
        chartDom.innerHTML = `<p>无法加载题目 ${qName} 的数据。</p>`;
        return;
    }
    const qFullScore = stat.manualFullScore || stat.maxScore;
    const isMinor = (recalculatedStats.minorStats[qName] != null);

    // 4.    核心    计算 *筛选后学生* 的平均题分和平均总分
    const qScores = [];
    const tScores = [];
    const scatterData = [];

    filteredStudents.forEach(s => {
        const tScore = s.totalScore;
        const qScore = isMinor ? s.minorScores[qName] : s.majorScores[qName];

        if (typeof tScore === 'number' && !isNaN(tScore) && typeof qScore === 'number' && !isNaN(qScore)) {
            tScores.push(tScore);
            qScores.push(qScore);
            scatterData.push([qScore, tScore, s.name]); // [X, Y, Name]
        }
    });

    if (scatterData.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">当前筛选下无有效学生数据。</p>`;
        return;
    }

    const avgTotal = tScores.reduce((a, b) => a + b, 0) / tScores.length;
    const avgQScore = qScores.reduce((a, b) => a + b, 0) / qScores.length;

    // 5.    核心    计算 Y 轴最大值 (卷面总分)
    let totalFullScore = 0;
    // (用户规则: 卷面总分 = 小题满分之和)
    if (recalculatedStats.minorStats) {
        for (const qn in recalculatedStats.minorStats) {
            const s = recalculatedStats.minorStats[qn];
            totalFullScore += (s.manualFullScore || s.maxScore);
        }
    }
    if (totalFullScore === 0) totalFullScore = Math.max(...tScores) * 1.1; // (备用)

    // 6. 将数据分为四个象限
    const qTR = [], qBR = [], qTL = [], qBL = [];
    // 颜色定义 (参考您的图片)
    const colors = {
        TR: '#f56c6c', // (右上) 尖子生 - (重点关注) ->    (您的图片中，右上是“短板”，但逻辑上应是右下)
        BR: '#dc3545', // (右下) 高总分, 低题分 ->    (这才是“短板”，标红)
        TL: '#E6A23C', // (左上) 低总分, 高题分 -> "低分高能"
        BL: '#409EFF'  // (左下)
    };

    scatterData.forEach(d => {
        const qScore = d[0];
        const tScore = d[1];
        if (tScore >= avgTotal && qScore >= avgQScore) qTR.push(d); // 高总分, 高题分
        else if (tScore >= avgTotal && qScore < avgQScore) qBR.push(d); // 高总分, 低题分 (短板!)
        else if (tScore < avgTotal && qScore >= avgQScore) qTL.push(d); // 低总分, 高题分
        else qBL.push(d); // 低总分, 低题分
    });

    // 7. 渲染 ECharts
    const option = {
        title: {
            text: `“${qName}” 题目-学生 诊断图`,
            subtext: `(班级: ${selectedClass})`,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                const data = params.data;
                return `<strong>${data[2]} (${params.seriesName})</strong><br/>` +
                    `卷面总分: ${data[1]}<br/>` +
                    `本题得分: ${data[0]}`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '10%', top: '15%' },
        xAxis: {
            type: 'value',
            name: `题目 “${qName}” 得分`,
            nameLocation: 'middle',
            nameGap: 30,
            min: 0,
            max: qFullScore,
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: '卷面总分',
            nameLocation: 'middle',
            nameGap: 40,
            min: 0,
            max: totalFullScore,
            splitLine: { show: false }
        },
        //    核心    十字象限线 和 标签
        series: [
            { name: '高总分-高题分 (已掌握)', type: 'scatter', data: qTR, itemStyle: { color: colors.TR, opacity: 0.7 } },
            { name: '高总分-低题分 (短板!!)', type: 'scatter', data: qBR, itemStyle: { color: colors.BR, opacity: 0.7 } },
            { name: '低总分-高题分 (亮点)', type: 'scatter', data: qTL, itemStyle: { color: colors.TL, opacity: 0.7 } },
            { name: '低总分-低题分', type: 'scatter', data: qBL, itemStyle: { color: colors.BL, opacity: 0.7 } },
            {
                // (这个空 series 专门用于画线)
                type: 'scatter',
                data: [],
                markLine: {
                    silent: true, animation: false,
                    label: { position: 'end' },
                    lineStyle: { type: 'dashed', color: 'red' },
                    data: [
                        { xAxis: avgQScore, name: `题均分(${avgQScore.toFixed(1)})` },
                        { yAxis: avgTotal, name: `总均分(${avgTotal.toFixed(1)})` }
                    ]
                }
            }
        ]
    };

    // 8.    核心    动态添加象限标签
    // (必须在 setOption 后调用)
    myChart.setOption(option);

    setTimeout(() => {
        const graphicElements = [
            { type: 'text', right: '12%', top: '18%', style: { text: '高总分\n高题分', fill: colors.TR, fontWeight: 'bold' } },
            { type: 'text', right: '12%', bottom: '12%', style: { text: '低总分\n高题分 (亮点)', fill: colors.BR, fontWeight: 'bold' } },
            { type: 'text', left: '12%', top: '18%', style: { text: '高总分\n低题分 (短板)', fill: colors.TL, fontWeight: 'bold' } },
            { type: 'text', left: '12%', bottom: '12%', style: { text: '低总分\n低题分', fill: colors.BL, fontWeight: 'bold' } }
        ];
        myChart.setOption({ graphic: graphicElements });
    }, 0);
}



// =====================================================================
//    NEW (Print Feature)    模块二：打印引擎
// =====================================================================

/**
 * 1. [打印引擎-核心] 启动打印作业 (修复版)
 * *    修正版 23 (数据读取修复)   
 * - (    ) 改为 async 函数，优先从 localforage 读取文件名，解决文件上传后打印显示 N/A 的问题。
 * - (保留) 所有的布局样式修复 (修正版 22)。
 */
async function startPrintJob(studentIds) {
    if (!studentIds || studentIds.length === 0) {
        alert("没有可打印的学生。");
        return;
    }

    // 1.    核心修复    获取考试信息
    // 优先从 localforage (IndexedDB) 读取，如果为空则降级读取 localStorage
    // 这样无论是“文件上传”还是“列表导入”，都能正确显示文件名
    let mainFile = await localforage.getItem('G_MainFileName');
    if (!mainFile) mainFile = localStorage.getItem('G_MainFileName') || '本次成绩';

    let compareFile = await localforage.getItem('G_CompareFileName');
    if (!compareFile) compareFile = localStorage.getItem('G_CompareFileName') || 'N/A';

    // (页眉的 HTML 内容)
    const headerHtml = `
        <h2>学生个体报告</h2>
        <p style="text-align: left; margin: 5px 0;"><strong>本次成绩:</strong> ${mainFile}</p>
        <p style="text-align: left; margin: 5px 0;"><strong>对比成绩:</strong> ${compareFile}</p>
    `;

    // 2. [核心] 生成打印页面的完整 HTML (样式保持您的修正版 22 不变)
    let html = `
        <html>
        <head>
            <title>学生个体报告</title>
            <style>
                /*    (Bug Fix)    
                   (将关键布局样式内置，防止加载延迟) 
                */
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }
                .student-card {
                    display: grid;
                    /*    修复 2    强制5列布局 */
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                    padding: 20px;
                    border: 1px solid #EEE;
                    border-radius: 8px;
                    margin-bottom: 20px;
                }
                .student-card div {
                    padding: 10px;
                    border-radius: 8px;
                }
                .student-card div span { display: block; font-size: 0.9em; color: #6c757d; }
                .student-card div strong { font-size: 1.5em; color: #333; }
                
                /* (复制 style.css 中的颜色定义) */
                .student-card .sc-name { background-color: rgba(0, 123, 255, 0.1); }
                .student-card .sc-name strong { color: #007bff; }
                .student-card .sc-id { background-color: rgba(108, 117, 125, 0.1); }
                .student-card .sc-id strong { color: #6c757d; }
                .student-card .sc-total { background-color: rgba(40, 167, 69, 0.1); }
                .student-card .sc-total strong { color: #28a745; }
                .student-card .sc-rank { background-color: rgba(253, 126, 20, 0.1); }
                .student-card .sc-rank strong { color: #fd7e14; }
                .student-card .sc-grade-rank { background-color: rgba(111, 66, 193, 0.1); }
                .student-card .sc-grade-rank strong { color: #6f42c1; }
                
                .progress { color: #00a876 !important; }
                .regress { color: #e53935 !important; }
                
                .table-container { width: 100%; margin-top: 15px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { 
                    border: 1px solid #999; 
                    padding: 10px; 
                    text-align: center; 
                    font-size: 0.9em;
                }
                th { background-color: #f0f0f0; }
                /*    关键样式结束    */


                /* --- 打印机设置 --- */
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 2cm;
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        /*    修复 1    移除了 padding-top: 130px; */
                    }
                    
                    /*    修复 1    移除了 .print-header-fixed 规则 */
                    
                    .print-header-preview {
                        /*    修复 1    让它在打印时显示 */
                        display: block !important;
                        text-align: center;
                        border-bottom: 2px solid #000;
                        padding-bottom: 15px;
                        margin-bottom: 20px;
                    }
                    .print-page-break {
                        page-break-before: always;
                    }
                    .print-page-container {
                        box-shadow: none;
                        margin: 0;
                        padding: 0;
                        width: auto;
                        min-height: auto;
                    }
                    .student-card {
                        box-shadow: none;
                        border: 1px solid #ccc;
                    }
                }
                
                /* --- 打印预览设置 --- */
                @media screen {
                    body {
                        background-color: #EEE;
                    }
                    .print-header-fixed {
                        /* (这个在预览时也不需要了) */
                        display: none;
                    }
                    .print-page-container {
                        background-color: #FFF;
                        width: 210mm;
                        min-height: 297mm;
                        margin: 20px auto;
                        padding: 2cm;
                        box-shadow: 0 0 10px rgba(0,0,0,0.2);
                        box-sizing: border-box;
                    }
                    .print-header-preview {
                        text-align: center;
                        border-bottom: 2px solid #000;
                        padding-bottom: 15px;
                        margin-bottom: 20px;
                    }
                }
            </style>
        </head>
        <body>
            
            <main class="print-content-wrapper">
    `;

    // 3. 循环生成每个学生的报告
    for (let i = 0; i < studentIds.length; i++) {
        const studentId = studentIds[i];
        const student = G_StudentsData.find(s => String(s.id) === String(studentId));
        if (!student) continue;

        const pageBreakClass = (i === 0) ? '' : 'print-page-break';

        html += `
            <div class="print-page-container ${pageBreakClass}">
            
                <div class="print-header-preview">
                    ${headerHtml}
                </div>

                ${generateStudentReportHTML(student)}

            </div>
        `;
    }

    // 4. 关闭 HTML
    html += `
            </main>
        </body>
        </html>
    `;

    // 5. 打开  窗口并打印 (保持1秒延迟)
    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 500);
}

/**
 * 2. [打印引擎-辅助] 为单个学生生成报告的 HTML
 * (这是 renderStudent 中 showReport 的无图表、返回字符串版本)
 * @param {Object} student - 要打印的学生对象
 * @returns {string} - 该学生报告的 HTML
 */
/**
 * (修改后) 2. [打印引擎-辅助] 为单个学生生成报告的 HTML
 *    最终同步版 - 支持隐藏排名   
 */
function generateStudentReportHTML(student) {
    if (!student) return '';

    // [    ] 掩码辅助函数 (与界面保持一致)
    const maskRank = (val) => window.G_HideRank ? '***' : val;
    const maskDiff = (diffVal, diffText) => window.G_HideRank ? '' : (diffVal !== 'N/A' ? diffText : '');

    // 1. 查找对比数据
    let oldStudent = null;
    let scoreDiff = 'N/A', rankDiff = 'N/A', gradeRankDiff = 'N/A';

    if (G_CompareData && G_CompareData.length > 0) {
        oldStudent = G_CompareData.find(s => String(s.id) === String(student.id));
    }

    if (oldStudent) {
        scoreDiff = (student.totalScore - oldStudent.totalScore).toFixed(2);
        rankDiff = oldStudent.rank - student.rank;
        gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 'N/A';
    }

    // 2. 生成学生卡片 HTML
    // 注意：排名的显示应用了 maskRank 和 maskDiff
    const cardHtml = `
        <div class="student-card">
            <div class="sc-name"><span>姓名</span><strong>${student.name}</strong></div>
            <div class="sc-id"><span>考号</span><strong>${student.id}</strong></div>
            <div class="sc-total">
                <span>总分 (上次: ${oldStudent ? oldStudent.totalScore : 'N/A'})</span>
                <strong class="${scoreDiff > 0 ? 'progress' : scoreDiff < 0 ? 'regress' : ''}">
                    ${student.totalScore}
                    ${(scoreDiff !== 'N/A' && oldStudent) ? `(${scoreDiff > 0 ? '▲' : '▼'} ${Math.abs(scoreDiff)})` : ''}
                </strong>
            </div>
            <div class="sc-rank">
                <span>班级排名 (上次: ${maskRank(oldStudent ? oldStudent.rank : 'N/A')})</span>
                <strong class="${rankDiff > 0 ? 'progress' : rankDiff < 0 ? 'regress' : ''}">
                    ${maskRank(student.rank)}
                    ${maskDiff(rankDiff, `(${rankDiff > 0 ? '▲' : '▼'} ${Math.abs(rankDiff)})`)}
                </strong>
            </div>
            <div class="sc-grade-rank">
                <span>年级排名 (上次: ${maskRank(oldStudent ? (oldStudent.gradeRank || 'N/A') : 'N/A')})</span>
                <strong class="${gradeRankDiff > 0 ? 'progress' : gradeRankDiff < 0 ? 'regress' : ''}">
                    ${maskRank(student.gradeRank || 'N/A')}
                    ${maskDiff(gradeRankDiff, `(${gradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(gradeRankDiff)})`)}
                </strong>
            </div>
        </div>
    `;

    // 3. 生成表格行 HTML
    const tableRowsHtml = G_DynamicSubjectList.map(subject => {
        let subjectScoreDiff = 'N/A';
        let subjectClassRankDiff = 'N/A';
        let subjectGradeRankDiff = 'N/A';

        if (oldStudent && oldStudent.scores) {
            const oldScore = oldStudent.scores[subject] || 0;
            const newScore = student.scores[subject] || 0;
            if (oldScore !== 0 || newScore !== 0) {
                subjectScoreDiff = (newScore - oldScore).toFixed(2);
            }
            if (oldStudent.classRanks && student.classRanks) {
                const oldClassRank = oldStudent.classRanks[subject] || 0;
                const newClassRank = student.classRanks[subject] || 0;
                if (oldClassRank > 0 && newClassRank > 0) {
                    subjectClassRankDiff = oldClassRank - newClassRank;
                }
            }
            if (oldStudent.gradeRanks && student.gradeRanks) {
                const oldGradeRank = oldStudent.gradeRanks[subject] || 0;
                const newGradeRank = student.gradeRanks[subject] || 0;
                if (oldGradeRank > 0 && newGradeRank > 0) {
                    subjectGradeRankDiff = oldGradeRank - newGradeRank;
                }
            }
        }

        const config = G_SubjectConfigs[subject] || {};
        const isAssignedSubject = config.isAssigned === true;
        let rankBasedScoreDisplay = '';

        if (isAssignedSubject) {
            const allScoresForSubject = G_StudentsData.map(s => s.scores[subject]);
            const fujianScore = calculateFujianAssignedScore(student.scores[subject], allScoresForSubject);
            rankBasedScoreDisplay = `<div style="font-size:0.85em; color:#6f42c1; margin-top:4px; font-weight:bold;">赋分: ${fujianScore}</div>`;
        } else {
            rankBasedScoreDisplay = `<div style="font-size:0.8em; color:#aaa; margin-top:4px;">(原始分)</div>`;
        }

        const tScore = (student.tScores && student.tScores[subject]) ? student.tScores[subject] : 'N/A';
        let tScoreDiffHtml = '';

        if (oldStudent && oldStudent.tScores && oldStudent.tScores[subject]) {
            const oldTScore = oldStudent.tScores[subject];
            if (tScore !== 'N/A' && oldTScore !== undefined && oldTScore !== null) {
                const diff = tScore - oldTScore;
                const diffAbs = Math.abs(diff).toFixed(1);
                if (diff > 0) tScoreDiffHtml = `<span class="progress" style="font-size:0.9em; margin-left:4px;">(▲${diffAbs})</span>`;
                else if (diff < 0) tScoreDiffHtml = `<span class="regress" style="font-size:0.9em; margin-left:4px;">(▼${diffAbs})</span>`;
            }
        }

        // 表格中的排名也应用 Mask 逻辑
        return `
            <tr>
                <td>${subject}</td>
                <td>
                    <div>
                        ${student.scores[subject] || 0}
                        ${(oldStudent && subjectScoreDiff !== 'N/A') ? `<span class="${subjectScoreDiff > 0 ? 'progress' : subjectScoreDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectScoreDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectScoreDiff)})</span>` : ''}
                    </div>
                    <div style="font-size:0.8em; color:#666; margin-top:4px;">
                        T分: <strong>${tScore}</strong> ${tScoreDiffHtml}
                    </div>
                </td>
                <td>
                    ${maskRank(student.classRanks ? (student.classRanks[subject] || 'N/A') : 'N/A')}
                    ${maskDiff(subjectClassRankDiff, `<span class="${subjectClassRankDiff > 0 ? 'progress' : subjectClassRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectClassRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectClassRankDiff)})</span>`)}
                </td>
                <td>
                    <div>
                        ${maskRank(student.gradeRanks ? (student.gradeRanks[subject] || 'N/A') : 'N/A')}
                        ${maskDiff(subjectGradeRankDiff, `<span class="${subjectGradeRankDiff > 0 ? 'progress' : subjectGradeRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectGradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectGradeRankDiff)})</span>`)}
                    </div>
                    ${rankBasedScoreDisplay}
                </td>
            </tr>
        `;
    }).join('');

    const tableHtml = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>科目</th>
                        <th>得分 (变化)</th>
                        <th>班级科目排名 (变化)</th>
                        <th>年级科目排名 (变化)</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
        </div>
    `;

    return cardHtml + tableHtml;
}


// =====================================================================
//    NEW (Feature)    模块十三：打印引擎 (One Button 完整版)
// =====================================================================

/**
 * [修复版] 13.18. 启动“小题分析-学生诊断表”的打印作业
 * - 修复：同时计算“知识点统计”和“小题统计”
 * - 解决：打印报告中“层均得分率”和“偏差”显示 N/A 的问题
 */
function startItemDetailPrintJob() {
    // 1. 找到打印按钮自己
    const printBtn = document.getElementById('item-print-btn');
    if (!printBtn) {
        alert("打印按钮未找到！");
        return;
    }

    // 2. 检查按钮的模式
    const target = printBtn.dataset.printTarget;
    let studentIdsToPrint = [];

    if (target === 'current') {
        const studentId = printBtn.dataset.studentId;
        if (studentId) studentIdsToPrint = [studentId];
    } else {
        // 模式B: 打印当前筛选的列表 (从 DOM 或 缓存读取)
        // 如果 G_ItemOutlierList 为空，说明还没计算过，需要先计算
        if (!G_ItemOutlierList || G_ItemOutlierList.length === 0) {
             // 尝试根据筛选条件现场计算名单
             // (为了代码简洁，这里建议用户先看表再打印，或者复用下方逻辑)
             // 如果这里为空，下面的逻辑会重新计算一遍
        } else {
             studentIdsToPrint = G_ItemOutlierList.map(s => s.id);
        }
    }

    if (studentIdsToPrint.length === 0) {
        // 如果全局列表为空，尝试从筛选条件全量计算
        // (下面的逻辑会覆盖这种情况)
    }

    if (studentIdsToPrint.length > 20 && !confirm(`即将打印 ${studentIdsToPrint.length} 份报告，是否继续？`)) {
        return;
    }

    // 3. 获取所有计算所需的上下文
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);
    const questionType = document.getElementById('item-outlier-type-filter').value;

    // 4. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    if (filteredStudents.length === 0) {
        alert("当前筛选范围内无学生数据。");
        return;
    }

    // ============================================================
    // 🔥🔥🔥 核心修复区域 🔥🔥🔥
    // ============================================================
    
    const recalculatedStats = getRecalculatedItemStats(subjectName);

    // A. 计算【知识点】统计 (目的是为了获得 studentsWithRates 和 计算分层归属)
    const knowledgeResult = calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents, questionType);
    
    // B. 计算【小题】统计 (这是打印表中 "层均得分率" 真正需要的数据源！)
    const itemResult = calculateLayeredItemStats(subjectName, numGroups, filteredStudents);

    // C. 重新生成一份临时的 OutlierList，确保能找到每个学生对应的层级 (G1/G2...)
    // (必须用 knowledgeResult 来生成，因为分层逻辑在那里)
    const tempOutlierList = calculateStudentKnowledgeOutliers(
        subjectName, 
        numGroups, 
        knowledgeResult.groupStats, 
        knowledgeResult.knowledgePoints, 
        knowledgeResult.studentsWithRates, 
        questionType
    );

    // 如果之前没选中学生，默认打印所有筛选出的学生
    if (studentIdsToPrint.length === 0) {
        studentIdsToPrint = tempOutlierList.map(s => s.id);
    }
    
    if (studentIdsToPrint.length === 0) {
         alert("没有可打印的学生。"); return;
    }
    // ============================================================

    // 6. 构建打印 HTML
    let html = `
        <html>
        <head>
            <title>${subjectName} - 学生知识点诊断</title>
            <style>
                body { font-family: "Segoe UI", sans-serif; padding: 2cm; color: #333; }
                .print-page-container { padding: 0; page-break-after: always; }
                .table-container { width: 100%; margin-top: 15px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { border: 1px solid #999; padding: 8px; text-align: center; }
                th { background-color: #f0f0f0; }
                .progress { color: #00a876 !important; font-weight: bold; }
                .regress { color: #e53935 !important; font-weight: bold; }
                @media print { 
                    .print-page-break { page-break-before: always; }
                    body { -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <main class="print-content-wrapper">
    `;

    // 7. 循环生成
    let printedCount = 0;
    for (let i = 0; i < studentIdsToPrint.length; i++) {
        const studentId = studentIdsToPrint[i];

        // 找到学生对象 (用 knowledgeResult 里的，因为包含了一些预计算属性，或者直接用 filteredStudents 也可以)
        const student = knowledgeResult.studentsWithRates.find(s => String(s.id) === String(studentId));
        
        // 找到学生的分层 (从 tempOutlierList 找)
        const outlierData = tempOutlierList.find(s => String(s.id) === String(studentId));

        if (!student || !outlierData) continue;

        const studentLayer = outlierData.layer; // e.g., "G1", "G8"
        const pageBreakClass = (printedCount === 0) ? '' : 'print-page-break';

        html += `
            <div class="print-page-container ${pageBreakClass}">
                ${generateItemDetailReportHTML(
                    student, 
                    studentLayer, 
                    subjectName, 
                    questionType, 
                    itemResult.groupStats, // ✅ 修复：传入小题维度的层级统计数据
                    recalculatedStats
                )}
            </div>
        `;
        printedCount++;
    }

    html += `</main></body></html>`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 1000);
}


/**
 * 13.19.    (打印辅助函数) 生成单个学生的诊断报告HTML
 * (这是 drawItemStudentDetailTable 的 "返回字符串" 版本)
 * @returns {string} - 该学生报告的 HTML
 */
function generateItemDetailReportHTML(student, studentLayer, subjectName, questionType, groupStats, recalculatedStats) {
    // 1. 获取上下文
    const studentName = student.name;
    const typeText = (questionType === 'minor') ? ' (仅小题)' : (questionType === 'major') ? ' (仅大题)' : ' (全部题目)';

    // 2. 获取层均分
    const layerAvgRates = groupStats[studentLayer];

    // 3. 获取题目满分
    const { minorStats, majorStats, minorQuestions, majorQuestions } = recalculatedStats;

    if (!layerAvgRates) {
        return `<h4>${studentName} - 无法计算 ${studentLayer} 的层级平均数据。</h4>`;
    }

    // 4. 遍历所有题目，计算偏差
    const allQuestionDetails = [];
    const processQuestion = (qName, stat, studentScore) => {
        if (!stat) return;
        const fullScore = stat.manualFullScore || stat.maxScore;
        const studentRate = (fullScore > 0 && typeof studentScore === 'number') ? (studentScore / fullScore) : null;
        const layerRate = layerAvgRates[qName];
        const deviation = (studentRate !== null && typeof layerRate === 'number') ? (studentRate - layerRate) : null;
        const kp = (G_ItemAnalysisConfig[subjectName] && G_ItemAnalysisConfig[subjectName][qName]) ? G_ItemAnalysisConfig[subjectName][qName].content : '';

        allQuestionDetails.push({
            qName: qName,
            kp: kp || 'N/A',
            studentScore: studentScore ?? 'N/A',
            fullScore: fullScore,
            studentRate: studentRate,
            layerRate: layerRate,
            deviation: deviation
        });
    };

    if (questionType === 'all' || questionType === 'minor') {
        (minorQuestions || []).forEach(qName => {
            processQuestion(qName, minorStats[qName], student.minorScores[qName]);
        });
    }
    if (questionType === 'all' || questionType === 'major') {
        (majorQuestions || []).forEach(qName => {
            processQuestion(qName, majorStats[qName], student.majorScores[qName]);
        });
    }

    // 5. 排序 (打印时默认按“短板”排序)
    allQuestionDetails.sort((a, b) => {
        const valA = (a.deviation === null) ? Infinity : a.deviation;
        const valB = (b.deviation === null) ? Infinity : b.deviation;
        return valA - valB;
    });

    // 6. 渲染表格
    let tableHtml = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>题号</th>
                        <th>知识点</th>
                        <th>学生得分</th>
                        <th>满分</th>
                        <th>学生得分率</th>
                        <th>层均得分率</th>
                        <th>得分率偏差</th>
                    </tr>
                </thead>
                <tbody>
                    ${allQuestionDetails.map(q => `
                        <tr>
                            <td><strong>${q.qName}</strong></td>
                            <td>${q.kp}</td>
                            <td>${q.studentScore}</td>
                            <td>${q.fullScore}</td>
                            <td>${q.studentRate !== null ? (q.studentRate * 100).toFixed(1) + '%' : 'N/A'}</td>
                            <td>${(q.layerRate !== null && q.layerRate !== undefined) ? (q.layerRate * 100).toFixed(1) + '%' : 'N/A'}</td>
                            <td>
                                ${(q.deviation !== null && q.deviation !== undefined)
            ? (q.deviation > 0
                ? `<strong class="progress">▲ ${(q.deviation * 100).toFixed(1)}%</strong>`
                : (q.deviation < 0
                    ? `<strong class="regress">▼ ${(q.deviation * 100).toFixed(1)}%</strong>`
                    : `0.0%`))
            : 'N/A'
        }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    // 7. 渲染页眉
    let headerHtml = `
        <div class="print-header" style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">
            <h2>${subjectName} - 学生知识点诊断</h2>
            <p style="text-align: left; margin: 5px 0;"><strong>学生:</strong> ${studentName} (${studentLayer}层)</p>
            <p style="text-align: left; margin: 5px 0;"><strong>题目范围:</strong> ${typeText}</p>
        </div>
    `;

    return headerHtml + tableHtml;
}

/**
 * 11.8.    启动“多次考试-成绩详情表”的打印作业
 */
function startMultiTablePrintJob(studentName, tableHtml) {
    const html = `
        <html>
        <head>
            <title>${studentName} - 历次考试成绩详情</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    margin: 2cm;
                }
                h2 { text-align: center; margin-bottom: 20px; }
                
                /* 基础表格样式 (复用 style.css) */
                table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
                th, td { 
                    border: 1px solid #999; 
                    padding: 8px; 
                    text-align: center; 
                }
                th { background-color: #f0f0f0; font-weight: bold; }
                
                /* 打印设置 */
                @media print {
                    @page { size: A4 landscape; } /* 横向打印，因为列很多 */
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <h2>${studentName} - 历次考试成绩详情表</h2>
            ${tableHtml}
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 1000);
}


/**
 * 11.9.    专门负责渲染“图表3：各科排名变化曲线”
 * - (核心修复) 数据清洗：只有当学生在某次考试中有有效分数时，才显示排名。
 * - (解决痛点) 即使后台计算了缺考排位，这里也会将其过滤为 null，防止图表乱连线。
 */
function renderSubjectRankChart(containerId, examNames, visibleExamData, studentId, checkedSubjects, rankType) {

    const series = [];

    // 遍历每一个被勾选的科目
    checkedSubjects.forEach(subject => {
        const classRankData = [];
        const gradeRankData = [];

        // 遍历每一次考试
        visibleExamData.forEach(exam => {
            const student = exam.students.find(s => String(s.id) === String(studentId));

            let validClassRank = null;
            let validGradeRank = null;

            //    核心逻辑    
            // 只有当学生存在，且该科目有有效分数时，才采纳排名
            if (student) {
                const score = student.scores[subject];
                // 只有分数存在且是数字时
                if (typeof score === 'number' && !isNaN(score)) {
                    // 安全读取排名
                    if (student.classRanks && student.classRanks[subject]) {
                        validClassRank = student.classRanks[subject];
                    }
                    if (student.gradeRanks && student.gradeRanks[subject]) {
                        validGradeRank = student.gradeRanks[subject];
                    }
                }
            }

            classRankData.push(validClassRank);
            gradeRankData.push(validGradeRank);
        });

        // 根据下拉框选择，决定添加哪些线条
        if (rankType === 'both' || rankType === 'class') {
            series.push({
                name: `${subject}-班排`,
                type: 'line',
                data: classRankData,
                smooth: true,
                connectNulls: true //    跳过空值连接 (根据你的需求)
            });
        }
        if (rankType === 'both' || rankType === 'grade') {
            series.push({
                name: `${subject}-年排`,
                type: 'line',
                data: gradeRankData,
                smooth: true,
                connectNulls: true //    跳过空值连接
            });
        }
    });

    // 调用通用的绘图函数渲染 (反转Y轴: true)
    renderMultiExamLineChart(containerId, '', examNames, series, true);
}

// =====================================================================
//    NEW    模块十四：AI 智能分析 (DeepSeek 集成)
// =====================================================================

/**
 * 14.0 [旗舰完整版 - 已清洗] 初始化 AI 模块
 * - 保留：批量生成、自动补录、历史记录等核心功能
 */
async function initAIModule() {

    initPromptManager();
    initAIHistoryUI(); 

    const apiKeyInput = document.getElementById('ai-api-key');
    const saveKeyBtn = document.getElementById('ai-save-key-btn');
    const analyzeBtn = document.getElementById('ai-analyze-btn');
    const searchInput = document.getElementById('ai-student-search');
    const modeSelect = document.getElementById('ai-mode-select');
    const itemSubjectWrapper = document.getElementById('ai-item-subject-wrapper');
    const itemSubjectSelect = document.getElementById('ai-item-subject');
    const itemClassWrapper = document.getElementById('ai-item-class-wrapper');
    const itemClassSelect = document.getElementById('ai-item-class');
    const studentSearchContainer = document.querySelector('.search-combobox');
    const qCountWrapper = document.getElementById('ai-q-count-wrapper');

    // ============================================================
    // 1. 动态注入“批量生成”按钮和“进度弹窗”
    // ============================================================
    const controlBar = analyzeBtn.parentElement;
    
    if (!document.getElementById('ai-batch-btn')) {
        const batchBtn = document.createElement('button');
        batchBtn.id = 'ai-batch-btn';
        batchBtn.className = 'sidebar-button';
        batchBtn.style.cssText = "background-color: #fd7e14; margin-right: 10px;";
        batchBtn.innerHTML = "📦 批量生成";
        controlBar.insertBefore(batchBtn, analyzeBtn);

        const batchModalHtml = `
        <div id="ai-batch-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3>📦 AI 批量报告生成器</h3>
                    <span onclick="document.getElementById('ai-batch-modal').style.display='none'" class="modal-close-btn">&times;</span>
                </div>
                <div class="modal-body">
                    <div id="ai-batch-config">
                        <div style="margin-bottom:10px; display:flex; gap:10px; align-items:center;">
                            <label style="font-weight:bold;">1. 选择班级:</label>
                            <select id="ai-batch-class" class="sidebar-select" style="flex:1;"></select>
                        </div>
                        <div style="margin-bottom:15px; border:1px solid #eee; padding:10px; border-radius:4px; background:#f9f9f9;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid #eee; padding-bottom:5px;">
                                <label style="font-weight:bold; font-size:0.9em;">2. 选择学生:</label>
                                <div>
                                    <a href="javascript:void(0)" id="ai-batch-select-all" style="font-size:0.8em; color:#007bff; margin-right:10px; text-decoration:none;">全选</a>
                                    <a href="javascript:void(0)" id="ai-batch-select-none" style="font-size:0.8em; color:#666; text-decoration:none;">清空</a>
                                </div>
                            </div>
                            <div id="ai-batch-student-list" style="max-height:150px; overflow-y:auto; display:grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap:5px;"></div>
                            <div id="ai-batch-selected-count" style="text-align:right; font-size:0.8em; color:#666; margin-top:5px;">已选: 0 人</div>
                        </div>
                        <div style="margin-bottom:15px; display:flex; gap:10px; align-items:center;">
                            <label style="font-weight:bold;">分析模式:</label>
                            <span id="ai-batch-mode-display" style="color:#6f42c1; font-weight:bold;">--</span>
                            <span style="font-size:0.8em; color:#999;">(跟随主界面选择)</span>
                        </div>
                        <button id="ai-batch-start-btn" class="sidebar-button" style="width:100%; background-color:#6f42c1;">🚀 开始批量生成</button>
                    </div>
                    <div id="ai-batch-progress-area" style="display:none;">
                        <div style="margin-bottom:5px; display:flex; justify-content:space-between;">
                            <span id="ai-batch-status">初始化...</span>
                            <span id="ai-batch-count">0/0</span>
                        </div>
                        <div style="width:100%; background:#eee; height:10px; border-radius:5px; overflow:hidden; margin-bottom:15px;">
                            <div id="ai-batch-bar" style="width:0%; height:100%; background:#28a745; transition:width 0.3s;"></div>
                        </div>
                        <div id="ai-batch-log" style="height:150px; overflow-y:auto; background:#f8f9fa; border:1px solid #eee; padding:10px; font-size:0.85em; color:#555; margin-bottom:15px;"></div>
                        <div style="display:flex; gap:10px;">
                            <button id="ai-batch-save-btn" class="sidebar-button" style="flex:1; background-color:#17a2b8;" disabled onclick="window.saveBatchToHistory()">💾 批量存档</button>
                            <button id="ai-batch-print-btn" class="sidebar-button" style="flex:1; background-color:#28a745;" disabled>🖨️ 批量打印</button>
                            <button id="ai-batch-stop-btn" class="sidebar-button" style="flex:0.5; background-color:#dc3545;">停止⏹</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', batchModalHtml);
        
        // 绑定事件
        batchBtn.addEventListener('click', openBatchModal);
        document.getElementById('ai-batch-start-btn').addEventListener('click', runBatchAnalysis);
        document.getElementById('ai-batch-print-btn').addEventListener('click', printBatchReports);
        document.getElementById('ai-batch-stop-btn').addEventListener('click', () => { window.stopBatchAI = true; });
        
        document.getElementById('ai-batch-select-all').onclick = () => toggleBatchSelection(true);
        document.getElementById('ai-batch-select-none').onclick = () => toggleBatchSelection(false);
        document.getElementById('ai-batch-class').addEventListener('change', () => {
            renderBatchStudentList(document.getElementById('ai-batch-class').value);
        });
    }

    // ============================================================
    // 2. 常规初始化
    // ============================================================

    // 加载 Key
    const savedKey = localStorage.getItem('G_DeepSeekKey');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        document.getElementById('ai-key-status').style.display = 'inline';
    }

    // 绑定顶部按钮
    const sendFollowUpBtn = document.getElementById('ai-send-btn');
    if (sendFollowUpBtn) sendFollowUpBtn.addEventListener('click', sendAIFollowUp);
    
    const printReportBtn = document.getElementById('ai-print-btn');
    if (printReportBtn) printReportBtn.addEventListener('click', printAIReport);

    const printRangeBtn = document.getElementById('ai-print-range-btn');
    if (printRangeBtn) {
        printRangeBtn.addEventListener('click', () => {
            const input = prompt("请输入要打印的对话轮次 (例如 '1' 或 '1-3')：", "1");
            if (input) printRangeReport(input);
        });
    }

    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key.startsWith('sk-')) {
            localStorage.setItem('G_DeepSeekKey', key);
            document.getElementById('ai-key-status').style.display = 'inline';
            alert('API Key 已保存！');
        } else { alert('请输入有效的 DeepSeek API Key'); }
    });

    // 独立的更新班级列表函数
    const updateClassList = () => {
        const subject = itemSubjectSelect.value;
        if (!subject || !window.G_ItemAnalysisData || !window.G_ItemAnalysisData[subject]) {
            itemClassSelect.innerHTML = `<option value="ALL">-- 全体年段 --</option>`;
            return;
        }
        const students = window.G_ItemAnalysisData[subject].students;
        const classes = [...new Set(students.map(s => s.class))].sort();
        const currentClass = itemClassSelect.value;
        let html = `<option value="ALL">-- 全体年段 --</option>`;
        html += classes.map(c => `<option value="${c}">${c}</option>`).join('');
        itemClassSelect.innerHTML = html;
        if (currentClass && (classes.includes(currentClass) || currentClass === 'ALL')) {
            itemClassSelect.value = currentClass;
        }
    };

    itemSubjectSelect.addEventListener('change', updateClassList);

    // 监听模式变化 (自动补录数据)
    modeSelect.addEventListener('change', async () => {
        const val = modeSelect.value;
        if (qCountWrapper) qCountWrapper.style.display = (val === 'question') ? 'inline-flex' : 'none';

        // 控制按钮可用状态
        if (val === 'teaching_guide') {
            analyzeBtn.disabled = false;
        } else {
            if (searchInput.dataset.selectedId) analyzeBtn.disabled = false;
            else analyzeBtn.disabled = true;
        }

        if (val === 'item_diagnosis' || val === 'teaching_guide') {
            itemSubjectWrapper.style.display = 'inline-flex';
            
            // 尝试补载数据
            if (!window.G_ItemAnalysisData || Object.keys(window.G_ItemAnalysisData).length === 0) {
                try {
                    itemSubjectSelect.innerHTML = `<option>⌛️ 加载中...</option>`;
                    const storedData = await localforage.getItem('G_ItemAnalysisData');
                    const storedConfig = await localforage.getItem('G_ItemAnalysisConfig');
                    if (storedData) {
                        window.G_ItemAnalysisData = storedData;
                        window.G_ItemAnalysisConfig = storedConfig || {};
                    }
                } catch (e) { console.error(e); }
            }

            if (window.G_ItemAnalysisData && Object.keys(window.G_ItemAnalysisData).length > 0) {
                const subjects = Object.keys(window.G_ItemAnalysisData);
                const currentVal = itemSubjectSelect.value;
                itemSubjectSelect.innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');
                if (!currentVal || !subjects.includes(currentVal)) itemSubjectSelect.value = subjects[0];
                if (typeof updateClassList === 'function') updateClassList();
            } else {
                itemSubjectSelect.innerHTML = `<option value="">请先导入数据</option>`;
                itemClassSelect.innerHTML = `<option value="ALL">-- 全体年段 --</option>`;
            }

            if (val === 'teaching_guide') {
                studentSearchContainer.style.display = 'none';
                itemClassWrapper.style.display = 'inline-flex';
            } else {
                studentSearchContainer.style.display = 'inline-block';
                itemClassWrapper.style.display = 'none';
            }
        } else {
            itemSubjectWrapper.style.display = 'none';
            itemClassWrapper.style.display = 'none';
            studentSearchContainer.style.display = 'inline-block';
        }
    });

    // 复制按钮
    document.getElementById('ai-copy-btn').addEventListener('click', () => {
        const content = document.getElementById('ai-content').innerText;
        navigator.clipboard.writeText(content).then(() => alert('内容已复制'));
    });

    // ============================================================
    // 3. 点击主分析按钮 (单次生成)
    // ============================================================
    analyzeBtn.addEventListener('click', () => {
        const studentId = searchInput.dataset.selectedId || "";
        const studentName = searchInput.dataset.selectedName || "全体同学";
        const mode = document.getElementById('ai-mode-select').value;
        const model = document.getElementById('ai-model-select').value;
        const qCount = document.getElementById('ai-q-count').value;
        const grade = document.getElementById('ai-grade-select').value;
        
        let targetSubject = document.getElementById('ai-item-subject').value;
        if (mode !== 'item_diagnosis' && mode !== 'teaching_guide') targetSubject = "";
        const targetClass = document.getElementById('ai-item-class').value || 'ALL';
        const apiKey = localStorage.getItem('G_DeepSeekKey');

        if (!apiKey) { alert('请先设置 DeepSeek API Key'); return; }

        if (mode === 'teaching_guide' || mode === 'item_diagnosis') {
            if (!targetSubject) { alert("请选择一个科目！"); return; }
            if (!window.G_ItemAnalysisData) { alert("无法读取数据，请先去模块13导入！"); return; }
            if (!window.G_ItemAnalysisData[targetSubject]) { alert(`找不到科目【${targetSubject}】的数据。`); return; }
            if (mode === 'item_diagnosis' && !studentId) { alert('请先选择一名学生'); return; }
        } else {
            if (!studentId) { alert('请先选择一名学生'); return; }
        }

        runAIAnalysis(apiKey, studentId, studentName, mode, model, qCount, grade, targetSubject, targetClass);
    });
    
    // 4. 初始化搜索逻辑 (一次性调用，替代了之前的重复代码)
    initStudentSearchLogic();
}

/**
 * [重构版] 生成 AI 提示词
 * 逻辑：准备数据上下文 (dataContextStr) -> 读取用户模板 -> 替换变量
 */
async function generateAIPrompt(studentId, studentName, mode, qCount = 3, grade = "高三", targetSubject = "", targetClass = "ALL") {

    // 1. 加载模板 (如果读取失败则使用默认)
    // 确保 DEFAULT_PROMPTS 已经在全局定义过 (见下文补充)
    const prompts = JSON.parse(localStorage.getItem('G_AI_Prompts')) || DEFAULT_PROMPTS;
    const activeId = localStorage.getItem('G_AI_ActivePromptId') || 'default';
    const template = prompts[activeId] || prompts['default'];

    // 2. 准备数据上下文 (Data Context)
    // 我们将根据不同的 mode，生成一段详细的数据描述文本，最后填入 {{data_context}}
    let dataContextStr = "";
    let paperContextInfo = "";

    // [通用] 尝试获取试卷原题文本 (如果存在)
    if (targetSubject && window.G_ItemAnalysisConfig && window.G_ItemAnalysisConfig[targetSubject]) {
        const fullText = window.G_ItemAnalysisConfig[targetSubject]['_full_paper_context_'];
        if (fullText && fullText.trim() !== "") {
            paperContextInfo = `\n=== 📄 附：本次考试完整试卷内容 ===\n${fullText.substring(0, 15000)}\n============================\n\n`;
        }
    }

    // ============================================================
    // 场景 A: 教师教学指导 (班级/年级视角)
    // ============================================================
    if (mode === 'teaching_guide') {
        if (!window.G_ItemAnalysisData || !window.G_ItemAnalysisData[targetSubject]) {
            return { system: template.system, user: "错误：没有找到该科目的小题数据，请先导入模块13。" };
        }

        const itemData = window.G_ItemAnalysisData[targetSubject];
        const itemConfig = window.G_ItemAnalysisConfig ? (window.G_ItemAnalysisConfig[targetSubject] || {}) : {};

        // 筛选学生
        let targetStudents = itemData.students;
        let scopeName = "全年段";
        if (targetClass !== 'ALL') {
            targetStudents = itemData.students.filter(s => s.class === targetClass);
            scopeName = targetClass;
        }

        dataContextStr += `【分析范围】：${scopeName} (共${targetStudents.length}人)\n`;
        dataContextStr += `【分析任务】：请分析该群体的得分率数据，找出共性薄弱点。\n\n`;
        dataContextStr += `【详细得分率数据】：\n`;
        dataContextStr += `| 题号 | 知识点 | 本次得分率 | 满分 |\n|---|---|---|---|\n`;

        // 辅助：计算得分率表格
        const appendRates = (qList, scoreKey, statsObj) => {
            qList.forEach(qName => {
                const gradeStat = statsObj[qName];
                if (!gradeStat) return;

                const config = itemConfig[qName] || {};
                const fullScore = config.fullScore || gradeStat.maxScore;
                const content = config.content || "未标记";

                if (fullScore > 0) {
                    let total = 0, count = 0;
                    targetStudents.forEach(s => {
                        const v = s[scoreKey][qName];
                        if (typeof v === 'number') { total += v; count++; }
                    });
                    const avg = count > 0 ? total / count : 0;
                    const ratio = (avg / fullScore * 100).toFixed(1);
                    dataContextStr += `| ${qName} | ${content} | ${ratio}% | ${fullScore} |\n`;
                }
            });
        };

        appendRates(itemData.minorQuestions, 'minorScores', itemData.minorStats);
        appendRates(itemData.majorQuestions, 'majorScores', itemData.majorStats);
    }

    // ============================================================
    // 场景 B: 学生小题深度诊断 (个人视角)
    // ============================================================
    else if (mode === 'item_diagnosis') {
        if (!window.G_ItemAnalysisData || !window.G_ItemAnalysisData[targetSubject]) {
            return { system: template.system, user: "错误：没有找到该科目的小题数据。" };
        }
        const itemData = window.G_ItemAnalysisData[targetSubject];
        const itemConfig = window.G_ItemAnalysisConfig ? (window.G_ItemAnalysisConfig[targetSubject] || {}) : {};

        // 查找学生
        let studentDetails = itemData.students.find(s => String(s.id) === String(studentId));
        if (!studentDetails) studentDetails = itemData.students.find(s => s.name === studentName);

        if (!studentDetails) {
            return { system: template.system, user: `错误：未在科目【${targetSubject}】中找到该学生数据。` };
        }

        dataContextStr += `【试卷总分】：${studentDetails.totalScore}\n`;
        dataContextStr += `【小题得分详情】(题号 | 知识点 | 得分/满分 | 班级均分 | 个人得分率)：\n`;

        const processQuestions = (qList, scoreObj, statsObj) => {
            qList.forEach(qName => {
                const score = scoreObj[qName];
                const stat = statsObj[qName];
                const config = itemConfig[qName] || {};
                const fullScore = config.fullScore || stat.maxScore;
                const content = config.content || "未标记";

                if (typeof score === 'number') {
                    const ratio = (fullScore > 0) ? (score / fullScore).toFixed(2) : 0;
                    // 只列出得分率低于 0.8 的题目，或者是大题，避免数据过长
                    // (或者全部列出，AI 处理能力很强)
                    dataContextStr += `- 题${qName} | ${content} | 得${score} (满${fullScore}) | 班均${stat.avg} | 率${ratio}\n`;
                }
            });
        };

        dataContextStr += `--- 客观题 ---\n`;
        processQuestions(itemData.minorQuestions, studentDetails.minorScores, itemData.minorStats);
        dataContextStr += `--- 主观题 ---\n`;
        processQuestions(itemData.majorQuestions, studentDetails.majorScores, itemData.majorStats);
    }

    // ============================================================
    // 场景 C: 综合趋势 / 偏科 / 出题 (通用数据)
    // ============================================================
    else {
        // 1. 获取历史数据
        const multiData = (await loadMultiExamData()).filter(e => !e.isHidden);
        dataContextStr += `【历史考试数据】：\n`;

        if (multiData.length === 0) {
            dataContextStr += `(暂无历史数据)\n`;
        } else {
            multiData.forEach(exam => {
                const s = exam.students.find(st => String(st.id) === String(studentId));
                if (s) {
                    dataContextStr += `- ${exam.label}: 总分${s.totalScore} (班排${s.rank}, 年排${s.gradeRank || '-'}); `;
                    // 简略各科
                    const scores = [];
                    for (let k in s.scores) scores.push(`${k}:${s.scores[k]}`);
                    dataContextStr += scores.join(', ') + "\n";
                }
            });
        }

        // 2. 获取本次详情
        const currentStudent = G_StudentsData.find(s => String(s.id) === String(studentId));
        if (currentStudent) {
            dataContextStr += `\n【本次考试详情】：\n`;
            dataContextStr += `总分: ${currentStudent.totalScore}, 班排: ${currentStudent.rank}\n`;
            dataContextStr += `各科明细 (科目: 分数 | 班排 | 年排 | T分):\n`;

            G_DynamicSubjectList.forEach(sub => {
                const score = currentStudent.scores[sub];
                if (score !== undefined) {
                    const cr = currentStudent.classRanks ? currentStudent.classRanks[sub] : '-';
                    const gr = currentStudent.gradeRanks ? currentStudent.gradeRanks[sub] : '-';
                    const tScore = (currentStudent.tScores && currentStudent.tScores[sub]) ? currentStudent.tScores[sub] : '-';
                    dataContextStr += `- ${sub}: ${score} | ${cr} | ${gr} | T:${tScore}\n`;
                }
            });
        }

        // 3. 特定模式补充说明
        if (mode === 'question') {
            dataContextStr += `\n【特殊指令】：请针对该生最薄弱的学科，生成 ${qCount} 道适合 ${grade} 水平的练习题。`;
        }
    }

    // 3. 拼接最终 Prompt
    // 将试卷内容放在最前面，数据放在中间
    const fullDataContext = paperContextInfo + dataContextStr;

    // 执行模板替换
    let finalUserPrompt = template.user
        .replace(/{{name}}/g, studentName)
        .replace(/{{grade}}/g, grade)
        .replace(/{{subject}}/g, targetSubject || "综合")
        .replace(/{{score}}/g, "") // 简单置空，具体数据在 data_context 里
        .replace(/{{rank}}/g, "")
        .replace(/{{data_context}}/g, fullDataContext);

    // 返回符合 API 格式的对象
    return {
        system: template.system,
        user: finalUserPrompt
    };
}

/**
 * 3. 调用 DeepSeek API (最终完整版)
 * - 支持 Prompt 模板 (从 generateAIPrompt 获取 system/user)
 * - 包含流式输出节流 (Throttle) 优化，防止页面卡顿
 * - 包含智能滚屏 (Smart Auto-scroll)
 * - 包含底部固定输入框状态管理
 */
async function runAIAnalysis(apiKey, studentId, studentName, mode, model, qCount, grade, targetSubject, targetClass) {
    const resultContainer = document.getElementById('ai-result-container');
    const loadingDiv = document.getElementById('ai-loading');
    const contentDiv = document.getElementById('ai-content');
    const chatHistoryDiv = document.getElementById('ai-chat-history');

    // 底部UI元素
    const inputArea = document.getElementById('ai-followup-input-area');
    const floatingStopBtn = document.getElementById('ai-floating-stop-btn');
    const sendBtn = document.getElementById('ai-send-btn');

    // UI 初始化检查
    if (typeof marked === 'undefined') { alert("错误：marked.js 未加载！"); return; }

    // 显示区域，清空旧历史
    resultContainer.style.display = 'block';
    if (chatHistoryDiv) chatHistoryDiv.innerHTML = '';

    // [关键] 确保输入框可见，禁用发送按钮
    if (inputArea) inputArea.style.display = 'flex';
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerText = '生成中...';
    }
    // 显示停止按钮
    if (floatingStopBtn) floatingStopBtn.style.display = 'flex';

    // 1. 构建静态 HTML 结构 (空壳)，防止重绘导致折叠失效
    contentDiv.innerHTML = `
        <div id="ai-response-wrapper">
            <details id="current-reasoning-box" class="ai-reasoning-box" style="display:none;" open>
                <summary><span>🧠 深度思考过程 (点击切换)</span></summary>
                <div id="current-reasoning-text" class="ai-reasoning-content"></div>
            </details>
            <div id="current-answer-text" class="typing-cursor" style="min-height: 50px;"></div>
        </div>
    `;

    const reasoningBox = document.getElementById('current-reasoning-box');
    const reasoningTextEl = document.getElementById('current-reasoning-text');
    const answerTextEl = document.getElementById('current-answer-text');

    // Loading 动画
    loadingDiv.style.display = 'block';

    // [关键] 重置当前历史记录 ID (  分析 =   记录)
    G_CurrentHistoryId = null;

    // AbortController 设置 (用于停止生成)
    if (currentAIController) currentAIController.abort();
    currentAIController = new AbortController();

    // 变量提升 (用于停止时保存)
    let fullReasoning = "";
    let fullContent = "";

    // 定义停止逻辑
    const handleStop = () => {
        if (currentAIController) {
            currentAIController.abort();
            currentAIController = null;

            // UI 恢复
            if (floatingStopBtn) floatingStopBtn.style.display = 'none';
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerText = '发送';
            }

            answerTextEl.classList.remove('typing-cursor');
            answerTextEl.innerHTML += `<br><br><em style="color: #dc3545;">(用户手动停止了生成)</em>`;

            // 触发保存逻辑 (如果已有内容)
            if (fullContent && fullContent.length > 0) {
                const modeEl = document.getElementById('ai-mode-select');
                const modeText = modeEl ? modeEl.selectedOptions[0].text : "AI分析";
                let historyTitle = `${studentName} - ${modeText}`;
                if (mode === 'teaching_guide') historyTitle = `教学指导 - ${targetSubject}`;

                // 保存未完成的记录
                saveToAIHistory(historyTitle, `${grade} | ${targetSubject} (未完成)`, G_CurrentHistoryId);
            }
        }
    };

    // 绑定停止事件
    if (floatingStopBtn) floatingStopBtn.onclick = handleStop;

    try {
        // 2. 生成 Prompt (使用模板)
        // 注意：generateAIPrompt 现在返回对象 { system: "...", user: "..." }
        const promptData = await generateAIPrompt(studentId, studentName, mode, qCount, grade, targetSubject, targetClass);

        // 检查 Prompt 生成是否报错 (字符串形式的错误)
        if (promptData.user && (promptData.user.startsWith('错误：') || promptData.user.startsWith('系统错误：'))) {
            throw new Error(promptData.user);
        }

        // 初始化对话历史 (使用模板中的 System Prompt)
        const temp = (model === 'deepseek-reasoner') ? 0.6 : 0.7;
        G_AIChatHistory = [
            { "role": "system", "content": promptData.system },
            { "role": "user", "content": promptData.user }
        ];

        // 3. 发起 Fetch 请求
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: model, messages: G_AIChatHistory, temperature: temp, stream: true }),
            signal: currentAIController.signal
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error?.message || `API 请求失败: ${response.status}`);
        }

        // 开始接收流
        loadingDiv.style.display = 'none';
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        //    核心优化    节流渲染变量
        let lastRenderTime = 0;
        const RENDER_INTERVAL = 100; // 每 100ms 渲染一次 Markdown，防止页面闪烁

        //    核心优化    智能滚屏检测
        // 我们监听窗口滚动，只有当用户本来就在最底部时，AI生成内容才自动滚动
        // 如果用户往上翻看历史，AI生成时不会强制把用户拉回底部
        let isUserAtBottom = true;
        const checkScroll = () => {
            const threshold = 100; // 容差
            // 使用 document.documentElement (整个页面) 或 main-content
            const el = document.documentElement;
            isUserAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
        };
        window.addEventListener('scroll', checkScroll);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const delta = json.choices[0].delta;

                        // A. 处理思考过程 (R1) - 纯文本，直接追加即可
                        if (delta.reasoning_content) {
                            if (fullReasoning === "") {
                                reasoningBox.style.display = "block";
                            }
                            fullReasoning += delta.reasoning_content;
                            reasoningTextEl.textContent = fullReasoning;
                            // 思考过程默认自动滚动
                            // reasoningTextEl.scrollTop = reasoningTextEl.scrollHeight;
                        }

                        // B. 处理正文内容 - 节流渲染 Markdown
                        if (delta.content) {
                            fullContent += delta.content;

                            const now = Date.now();
                            // 只有间隔超过 100ms 才重  解析 Markdown 并渲染 DOM
                            if (now - lastRenderTime > RENDER_INTERVAL) {
                                renderMarkdownWithMath(answerTextEl, fullContent);
                                lastRenderTime = now;

                                // 智能滚动：仅当用户在底部时滚动
                                if (isUserAtBottom) {
                                    // 滚动整个窗口到底部
                                    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
                                }
                            }
                        }
                    } catch (e) { }
                }
            }
        }

        // 移除滚动监听
        window.removeEventListener('scroll', checkScroll);

        // 4. 循环结束：确保最后一次内容被完整渲染
        renderMarkdownWithMath(answerTextEl, fullContent);
        // 最后强制滚动到底部
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

        // 生成结束，更  历史上下文
        G_AIChatHistory.push({ "role": "assistant", "content": fullContent });

        // 5. 自动保存到历史记录存档
        const modeEl = document.getElementById('ai-mode-select');
        const modeText = modeEl ? modeEl.selectedOptions[0].text : "AI分析";
        let historyTitle = `${studentName} - ${modeText}`;
        if (mode === 'teaching_guide') historyTitle = `教学指导 - ${targetSubject}`;

        // 传入 G_CurrentHistoryId (此时为 null)，返回  生成的 ID
        const newId = saveToAIHistory(historyTitle, `${grade} | ${targetSubject}`, G_CurrentHistoryId);
        G_CurrentHistoryId = newId; // 更  全局 ID

    } catch (err) {
        loadingDiv.style.display = 'none';
        if (err.name === 'AbortError') {
            // 已在 handleStop 处理
            answerTextEl.classList.remove('typing-cursor');
        } else {
            // 显示错误信息
            answerTextEl.innerHTML = `
                <div style="padding: 20px; background-color: #fff5f5; border-left: 5px solid #dc3545; color: #721c24;">
                    <h3>⚠️ 出错了</h3>
                    <p>${err.message}</p>
                </div>
            `;
        }
    } finally {
        answerTextEl.classList.remove('typing-cursor');
        if (floatingStopBtn) floatingStopBtn.style.display = 'none';
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerText = '发送';
        }
        currentAIController = null;
    }
}


// ============================================================
//    NEW Feature: 跨考试难度加权对比分析
// ============================================================

// 1. 初始化对比下拉框 (增强版：支持动态加载科目)
async function initDiffCompareUI() {
    const selectA = document.getElementById('comp-exam-a');
    const selectB = document.getElementById('comp-exam-b');
    const selectSub = document.getElementById('comp-subject-select');
    
    if (!selectA || !selectB || !selectSub) return;

    // 1. 加载所有可用考试 (当前 + 历史存档)
    const library = await localforage.getItem('G_ItemAnalysis_Library') || [];
    
    // 构建选项：当前数据 + 历史数据
    let optionsHtml = `<option value="current">当前正在分析的数据 (未存档)</option>`;
    optionsHtml += library.map(item => `<option value="${item.id}">${item.name} (${item.date})</option>`).join('');

    selectA.innerHTML = optionsHtml;
    selectB.innerHTML = optionsHtml;

    // 2. 定义：根据选中的考试ID，动态更新科目列表
    const updateSubjectList = async () => {
        const examId = selectA.value; // 以考试 A 为准
        let subjects = [];

        if (examId === 'current') {
            // 读取当前内存数据
            if (window.G_ItemAnalysisData) {
                subjects = Object.keys(window.G_ItemAnalysisData);
            }
        } else {
            // 读取历史存档数据
            const lib = await localforage.getItem('G_ItemAnalysis_Library') || [];
            const record = lib.find(r => r.id === examId);
            if (record && record.data) {
                subjects = Object.keys(record.data);
            }
        }

        // 渲染科目下拉框
        if (subjects.length > 0) {
            // 记录当前选中的值，尝试在刷新后保持
            const oldVal = selectSub.value;
            selectSub.innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');
            if (subjects.includes(oldVal)) selectSub.value = oldVal;
        } else {
            selectSub.innerHTML = `<option value="">无可用科目</option>`;
        }
    };

    // 3. 绑定事件：当考试A变化时，刷新科目列表
    selectA.onchange = updateSubjectList;

    // 4. 绑定对比按钮事件
    document.getElementById('btn-run-diff-compare').onclick = performDiffCompare;

    // 5. 初始执行一次，填满科目
    await updateSubjectList();
}



// 2. 核心计算逻辑
async function performDiffCompare() {
    const idA = document.getElementById('comp-exam-a').value;
    const idB = document.getElementById('comp-exam-b').value;
    const subject = document.getElementById('comp-subject-select').value;

    if (!idA || !idB) { alert("请选择两次考试进行对比"); return; }

    // 辅助：加载数据
    const loadData = async (id) => {
        if (id === 'current') {
            return { 
                data: window.G_ItemAnalysisData, 
                config: window.G_ItemAnalysisConfig,
                name: "当前数据"
            };
        } else {
            const library = await localforage.getItem('G_ItemAnalysis_Library') || [];
            const record = library.find(r => r.id === id);
            return record ? { data: record.data, config: record.config, name: record.name } : null;
        }
    };

    const recA = await loadData(idA);
    const recB = await loadData(idB);

    if (!recA || !recA.data[subject]) { alert(`考试A中未找到科目：${subject}`); return; }
    if (!recB || !recB.data[subject]) { alert(`考试B中未找到科目：${subject}`); return; }

    // 核心公式计算函数
    // Formula: Sum( (1 - Difficulty) * QuestionTotalScore ) / StudentCount
    const calculateWeightedMetric = (examRecord, subName) => {
        const itemData = examRecord.data[subName];
        const itemConfig = examRecord.config[subName] || {};
        const students = itemData.students;
        
        // 获取所有题目
        const allQuestions = [...(itemData.minorQuestions||[]), ...(itemData.majorQuestions||[])];
        
        // 按班级分组
        const classMap = { '全年段': students };
        students.forEach(s => {
            if (!classMap[s.class]) classMap[s.class] = [];
            classMap[s.class].push(s);
        });

        const results = {}; // { "全年段": 120.5, "1班": 118.2 ... }

        for (const [className, groupStudents] of Object.entries(classMap)) {
            if (groupStudents.length === 0) continue;

            let numerator = 0; // 分子累加

            allQuestions.forEach(qName => {
                // 1. 获取配置的难度 (默认为0)
                const conf = itemConfig[qName] || {};
                const difficulty = (conf.manualDifficulty !== undefined) ? conf.manualDifficulty : 0;
                
                // 2. 计算该题在该群体中的总分
                let qTotalScore = 0;
                groupStudents.forEach(s => {
                    // 尝试从小题或大题分数中获取
                    let val = s.minorScores[qName];
                    if (val === undefined) val = s.majorScores[qName];
                    
                    if (typeof val === 'number' && !isNaN(val)) {
                        qTotalScore += val;
                    }
                });

                // 3. 累加公式项: (1 - 难度) * 群体该题总分
                numerator += (1 - difficulty) * qTotalScore;
            });

            // 4. 最终计算: 分子 / 参考人数
            results[className] = parseFloat((numerator / groupStudents.length).toFixed(2));
        }

        return results;
    };

    const resultA = calculateWeightedMetric(recA, subject);
    const resultB = calculateWeightedMetric(recB, subject);

    renderDiffCompareCharts(resultA, resultB, recA.name, recB.name);
}

// 3. 渲染图表
function renderDiffCompareCharts(resA, resB, nameA, nameB) {
    // 提取所有班级 (并集)
    const classes = Array.from(new Set([...Object.keys(resA), ...Object.keys(resB)])).sort();
    // 把 "全年段" 放在最前面
    const sortedClasses = ['全年段', ...classes.filter(c => c !== '全年段')];

    const dataA = sortedClasses.map(c => resA[c] || 0);
    const dataB = sortedClasses.map(c => resB[c] || 0);
    const diffData = sortedClasses.map(c => {
        const va = resA[c] || 0;
        const vb = resB[c] || 0;
        return parseFloat((va - vb).toFixed(2));
    });

    // 图表1：对比柱状图
    const chartBar = echarts.init(document.getElementById('chart-diff-compare-bar'));
    chartBar.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { data: [nameA, nameB], top: 0 },
        grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
        xAxis: { type: 'category', data: sortedClasses, axisLabel: { rotate: 30 } },
        yAxis: { type: 'value', name: '加权得分指标', scale:true },
        series: [
            { name: nameA, type: 'bar', data: dataA, itemStyle: { color: '#3498db' } },
            { name: nameB, type: 'bar', data: dataB, itemStyle: { color: '#e67e22' } }
        ]
    });

    // 图表2：差异瀑布图/柱状图
    const chartDiff = echarts.init(document.getElementById('chart-diff-compare-diff'));
    chartDiff.setOption({
        tooltip: { trigger: 'axis', formatter: '{b}<br/>差异: {c}' },
        grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
        xAxis: { type: 'category', data: sortedClasses, axisLabel: { rotate: 30 } },
        yAxis: { type: 'value', name: '差异值 (A - B)' },
        series: [
            {
                name: '差异',
                type: 'bar',
                data: diffData,
                itemStyle: {
                    color: (params) => params.value >= 0 ? '#2ecc71' : '#e74c3c'
                },
                label: { show: true, position: 'top' }
            }
        ]
    });
}

// 4. [最终完整版] 发送追问消息 (支持 R1 思考、单独打印、历史记录更  )
async function sendAIFollowUp() {
    const input = document.getElementById('ai-user-input');
    const chatHistoryDiv = document.getElementById('ai-chat-history');
    const apiKey = localStorage.getItem('G_DeepSeekKey');
    const model = document.getElementById('ai-model-select').value;

    // 底部UI元素
    const floatingStopBtn = document.getElementById('ai-floating-stop-btn');
    const sendBtn = document.getElementById('ai-send-btn');

    const userText = input.value.trim();
    if (!userText) return;

    // 1. UI: 用户消息气泡
    input.value = '';
    const userBubble = document.createElement('div');
    userBubble.style.cssText = "background: #e3f2fd; padding: 10px 15px; border-radius: 15px 15px 0 15px; margin: 10px 0 10px auto; max-width: 80%; color: #333; text-align: right; align-self: flex-end; width: fit-content;";
    userBubble.innerText = userText;
    chatHistoryDiv.appendChild(userBubble);

    // 2. UI: AI 回复容器
    const aiBubble = document.createElement('div');
    aiBubble.style.cssText = "background: #f8f9fa; padding: 15px; border-radius: 0 15px 15px 15px; margin: 10px 0; border: 1px solid #eee; min-height: 40px; position: relative;";

    // 注入结构：打印按钮 + 折叠框 + 正文框
    aiBubble.innerHTML = `
        <button class="ai-bubble-print-btn" title="单独打印此条对话">🖨️</button>
        <details class="ai-reasoning-box" style="display:none;" open>
            <summary><span>🧠 深度思考过程 (追问)</span></summary>
            <div class="ai-reasoning-content"></div>
        </details>
        <div class="ai-answer-content typing-cursor"></div>
    `;
    chatHistoryDiv.appendChild(aiBubble);

    // 获取内部引用
    const printBtn = aiBubble.querySelector('.ai-bubble-print-btn');
    const reasoningBox = aiBubble.querySelector('details');
    const reasoningContentEl = aiBubble.querySelector('.ai-reasoning-content');
    const answerContentEl = aiBubble.querySelector('.ai-answer-content');

    // 绑定单条打印事件
    printBtn.onclick = () => {
        const currentReasoning = reasoningContentEl.innerText;
        const currentAnswer = answerContentEl.innerHTML;
        printSingleChatTurn(userText, currentAnswer, currentReasoning);
    };

    // [关键] UI 状态更  ：显示停止按钮，禁用发送
    if (floatingStopBtn) floatingStopBtn.style.display = 'flex';
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerText = '生成中...';
    }

    G_AIChatHistory.push({ "role": "user", "content": userText });

    // AbortController
    if (currentAIController) currentAIController.abort();
    currentAIController = new AbortController();

    // 定义停止逻辑
    const handleStop = () => {
        if (currentAIController) {
            currentAIController.abort();
            currentAIController = null;

            // UI 恢复
            if (floatingStopBtn) floatingStopBtn.style.display = 'none';
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerText = '发送';
            }

            answerContentEl.classList.remove('typing-cursor');
            answerContentEl.innerHTML += `<br><em style="color: #dc3545;">(已停止)</em>`;

            // 手动停止时，更  历史记录
            if (G_CurrentHistoryId) {
                saveToAIHistory(null, null, G_CurrentHistoryId);
            }
        }
    };

    // 绑定停止按钮
    if (floatingStopBtn) floatingStopBtn.onclick = handleStop;

    let fullReasoning = "";
    let fullContent = "";

    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: model, messages: G_AIChatHistory, temperature: 0.6, stream: true }),
            signal: currentAIController.signal
        });

        if (!response.ok) throw new Error("API 请求失败");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const delta = json.choices[0].delta;

                        // A. 思考过程
                        if (delta.reasoning_content) {
                            if (fullReasoning === "") reasoningBox.style.display = "block";
                            fullReasoning += delta.reasoning_content;
                            reasoningContentEl.textContent = fullReasoning;
                        }

                        // B. 正文内容
                        if (delta.content) {
                            fullContent += delta.content;
                            requestAnimationFrame(() => {
                                renderMarkdownWithMath(answerContentEl, fullContent);
                            });
                        }
                    } catch (e) { }
                }
            }
        }

        // 生成结束，保存上下文
        G_AIChatHistory.push({ "role": "assistant", "content": fullContent });

        // [关键] 更  历史记录 (追问内容存入 chatContent)
        if (G_CurrentHistoryId) {
            saveToAIHistory(null, null, G_CurrentHistoryId);
        }

    } catch (err) {
        if (err.name !== 'AbortError') {
            answerContentEl.innerHTML += `<div style="color: red; margin-top:10px;">❌ 出错: ${err.message}</div>`;
        }
    } finally {
        answerContentEl.classList.remove('typing-cursor');
        if (floatingStopBtn) floatingStopBtn.style.display = 'none';
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerText = '发送';
        }
        currentAIController = null;
    }
}

function renderMarkdownWithMath(element, markdown) {
    //    最终修复    移除所有的 replace 预处理
    // 因为 Prompt 已经让 AI 生成了标准的 LaTeX 格式 ($...$)
    // 我们直接渲染，不再画蛇添足，这样就不会导致换行或乱码了

    // 1. 保护公式 (防止 marked.js 把公式里的符号误认为是 markdown 语法)
    const mathSegments = [];
    const protectedMarkdown = markdown.replace(
        /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\ce\{[^\}]+\}|\$[^\$]+\$)/g,
        (match) => {
            const placeholder = `MATHBLOCK${mathSegments.length}END`;
            mathSegments.push(match);
            return placeholder;
        }
    );

    // 2. 渲染 Markdown
    let html = marked.parse(protectedMarkdown);

    // 3. 还原公式
    mathSegments.forEach((segment, index) => {
        html = html.replace(`MATHBLOCK${index}END`, () => segment);
    });

    // 4. 注入 HTML
    element.innerHTML = html;

    // 5. 渲染 Math (KaTeX)
    if (window.renderMathInElement) {
        renderMathInElement(element, {
            delimiters: [
                { left: "$$", right: "$$", display: true }, // 块级公式 (居中)
                { left: "\\[", right: "\\]", display: true },
                { left: "$", right: "$", display: false },  // 行内公式 (不换行)
                { left: "\\(", right: "\\)", display: false }
            ],
            throwOnError: false
            // [重要] 确保这里没有 macros 配置
        });
    }
}

/**
 * 14.1    打印 AI 分析报告 (包含追问记录)
 */
function printAIReport() {
    const contentDiv = document.getElementById('ai-content');
    const historyDiv = document.getElementById('ai-chat-history'); //    获取追问容器

    // 检查是否有内容
    const hasInitialContent = contentDiv && contentDiv.innerHTML.trim() !== '';
    const hasHistoryContent = historyDiv && historyDiv.innerHTML.trim() !== '';

    if (!hasInitialContent && !hasHistoryContent) {
        alert("没有可打印的内容！请先生成分析报告。");
        return;
    }

    // 1. 获取上下文信息 (用于页眉)
    const modeEl = document.getElementById('ai-mode-select');
    const modeText = modeEl ? modeEl.selectedOptions[0].text : "分析报告";
    const grade = document.getElementById('ai-grade-select').value;
    // [修改后] -------------- 开始 --------------
    let subject = document.getElementById('ai-item-subject').value;
    
    // 如果是综合类模式，强制显示为“综合”
    if (modeEl.value === 'trend' || modeEl.value === 'weakness' || modeEl.value === 'question') {
        subject = "综合";
    } else {
        subject = subject || "综合";
    }
    let title = "";
    let subTitle = "";

    if (modeEl.value === 'teaching_guide') {
        const className = document.getElementById('ai-item-class').value;
        const classText = className === 'ALL' ? '全年段' : className;
        title = `教学诊断报告 - ${subject}`;
        subTitle = `分析对象：${classText} | 年级：${grade}`;
    } else {
        const searchInput = document.getElementById('ai-student-search');
        const studentName = searchInput.dataset.selectedName || "学生";
        title = `学业分析报告 - ${studentName}`;
        subTitle = `年级：${grade} | 科目：${subject} | 模式：${modeText}`;
    }

    // 2.    核心修改    拼接内容：首次回答 + 追问记录
    let reportHtml = "";

    if (hasInitialContent) {
        reportHtml += contentDiv.innerHTML;
    }

    if (hasHistoryContent) {
        // 添加一个分割线和标题，区分追问部分
        reportHtml += `
            <div style="margin-top: 40px; padding-top: 20px; border-top: 2px dashed #ccc;">
                <h3 style="color: #333; border-left: 4px solid #666; padding-left: 10px;">💬 深度追问记录</h3>
                ${historyDiv.innerHTML}
            </div>
        `;
    }

    // 3. 构建打印页面
    const printHtml = `
        <html>
        <head>
            <title>${title}</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
            <style>
                body {
                    font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
                    line-height: 1.6;
                    padding: 2cm;
                    color: #333;
                }
                /* 页眉样式 */
                .print-header {
                    text-align: center;
                    border-bottom: 2px solid #333;
                    margin-bottom: 30px;
                    padding-bottom: 10px;
                }
                .print-header h1 { margin: 0 0 10px 0; font-size: 24px; }
                .print-header p { margin: 0; color: #666; font-size: 14px; }

                /* 内容样式复刻 */
                h1, h2, h3 { color: #000; margin-top: 1.5em; }
                h3 { font-size: 1.2em; border-left: 4px solid #007bff; padding-left: 10px; }
                ul, ol { padding-left: 25px; }
                li { margin-bottom: 5px; }
                p { text-align: justify; margin-bottom: 1em; }
                strong { font-weight: 900; background-color: #eee; padding: 0 4px; border-radius: 2px; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { border: 1px solid #999; padding: 8px; text-align: center; font-size: 0.9em; }
                th { background-color: #f0f0f0; font-weight: bold; }
                blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; background-color: #f9f9f9; font-style: italic; }

                /*    追问对话气泡样式 (确保打印时也能看到气泡) */
                div[style*="background: #e3f2fd"] { 
                    /* 用户气泡 */
                    background-color: #e3f2fd !important; 
                    border: 1px solid #bbdefb;
                    color: #0d47a1;
                    margin: 15px 0 15px auto !important; /* 强制靠右 */
                    max-width: 80%;
                    padding: 10px 15px;
                    border-radius: 15px 15px 0 15px;
                    text-align: right;
                }
                div[style*="background: #f8f9fa"] { 
                    /* AI 气泡 */
                    background-color: #f8f9fa !important;
                    border: 1px solid #dee2e6;
                    margin: 15px 0;
                    padding: 15px;
                    border-radius: 0 15px 15px 15px;
                }

                @media print {
                    @page { size: A4 portrait; margin: 0; }
                    /* 强制打印背景色 (针对气泡) */
                    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1>${title}</h1>
                <p>${subTitle} | 生成时间：${new Date().toLocaleString()}</p>
            </div>
            
            <div class="report-content">
                ${reportHtml}
            </div>
        </body>
        </html>
    `;

    // 4. 执行打印
    const win = window.open('', '_blank');
    win.document.write(printHtml);
    win.document.close();

    setTimeout(() => {
        win.focus();
        win.print();
    }, 1000);
}
// =====================================================================
//    NEW    模块十四：AI 历史记录管理器
// =====================================================================

const AI_HISTORY_KEY = 'G_AI_History_Archive';

/**
 * 初始化历史记录 UI 和事件
 * (需要在 initAIModule 中调用)
 */
function initAIHistoryUI() {
    const drawer = document.getElementById('ai-history-drawer');
    const toggleBtn = document.getElementById('ai-history-toggle-btn');
    const closeBtn = document.getElementById('ai-history-close-btn');
    const clearBtn = document.getElementById('ai-history-clear-btn');

    // 开关抽屉
    toggleBtn.addEventListener('click', () => {
        drawer.classList.add('open');
        renderAIHistoryList(); // 每次打开时刷  列表
    });
    closeBtn.addEventListener('click', () => {
        drawer.classList.remove('open');
    });

    // 清空所有
    clearBtn.addEventListener('click', () => {
        if (confirm('确定要删除所有历史对话记录吗？此操作不可撤销。')) {
            localStorage.removeItem(AI_HISTORY_KEY);
            renderAIHistoryList();
        }
    });

    // 点击遮罩层关闭 (如果想做的更细致，可以加个点击 content 关闭 drawer 的逻辑，这里暂略)
}

/**
 * [重构版] 保存/更   AI 对话历史
 * @param {string} title - 标题
 * @param {string} subTitle - 副标题
 * @param {number|null} existingId - 如果是更  现有记录，传入 ID；否则传 null
 */
/**
 * [核心修复版] 保存/更新 AI 对话历史
 * - 修复：更新记录时(如追问)，若未传入新标题，自动保留旧标题，防止变成 "null"
 */
function saveToAIHistory(title, subTitle, existingId = null, customMainContent = null) {
    const contentDiv = document.getElementById('ai-content');
    const historyDiv = document.getElementById('ai-chat-history');

    // 1. 获取内容 (兼容批量模式和单人模式)
    let mainHtml = "";
    let chatHtml = "";

    if (customMainContent !== null && customMainContent !== undefined) {
        mainHtml = customMainContent;
        chatHtml = ""; 
    } else {
        mainHtml = contentDiv ? contentDiv.innerHTML : "";
        chatHtml = historyDiv ? historyDiv.innerHTML : "";
    }

    // 内容太少不保存
    if (!mainHtml || mainHtml.trim().length < 5) {
        return null;
    }

    const AI_HISTORY_KEY = 'G_AI_History_Archive';
    let history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || "[]");
    let recordId = existingId;

    // 2. [关键修复] 查找旧记录，准备继承标题
    let oldRecord = null;
    let index = -1;
    
    if (existingId) {
        index = history.findIndex(r => r.id === existingId);
        if (index !== -1) {
            oldRecord = history[index];
        }
    }

    // 3. 构建记录对象
    const record = {
        id: existingId || Date.now() + Math.random(),
        timestamp: new Date().toLocaleString(),
        
        // [修复核心]：优先使用传入的标题；如果传入为 null 且存在旧记录，则继承旧标题；否则显示默认值
        title: title || (oldRecord ? oldRecord.title : "AI分析报告"),
        subTitle: subTitle || (oldRecord ? oldRecord.subTitle : "综合分析"),
        
        mainContent: mainHtml,
        chatContent: chatHtml
    };

    // 4. 写入数组
    if (index !== -1) {
        history[index] = record; // 更新现有
        recordId = record.id;
    } else {
        history.unshift(record); // 插入头部
        recordId = record.id;
    }

    // 限制数量
    if (history.length > 200) history = history.slice(0, 200);
    
    localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(history));

    // 5. 刷新 UI
    if (document.getElementById('ai-history-list')) {
        renderAIHistoryList();
    }

    return recordId;
}

/**
 * 渲染历史记录列表
 */
function renderAIHistoryList() {
    const listContainer = document.getElementById('ai-history-list');
    const history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || "[]");

    if (history.length === 0) {
        listContainer.innerHTML = `<p style="color: #999; text-align: center; margin-top: 40px;">暂无历史记录</p>`;
        return;
    }

    listContainer.innerHTML = history.map(item => `
        <div class="history-item" onclick="loadAIHistoryItem(${item.id})">
            <button class="history-delete-btn" onclick="deleteAIHistoryItem(event, ${item.id})">&times;</button>
            <h4>${item.title}</h4>
            <p>${item.subTitle}</p>
            <span class="history-date">${item.timestamp}</span>
        </div>
    `).join('');
}

/**
 * [重构版] 加载单条历史记录
 */
function loadAIHistoryItem(id) {
    const history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || "[]");
    const item = history.find(r => r.id === id);

    if (item) {
        // 1. 恢复主回答
        const contentDiv = document.getElementById('ai-content');
        contentDiv.innerHTML = item.mainContent || item.content; // 兼容旧数据(item.content)

        // 2.    NEW    恢复追问记录
        const historyDiv = document.getElementById('ai-chat-history');
        if (historyDiv) {
            historyDiv.innerHTML = item.chatContent || ""; // 如果是旧数据可能没有 chatContent
        }

        // 3. 设置当前会话 ID (这样加载旧记录后，继续追问会保存在这条记录里，而不是  建)
        G_CurrentHistoryId = item.id;

        // 4. 显示容器
        document.getElementById('ai-result-container').style.display = 'block';

        // 5. 重  渲染公式
        const renderTarget = document.getElementById('ai-result-container');
        if (window.renderMathInElement) {
            renderMathInElement(renderTarget, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "\\[", right: "\\]", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\(", right: "\\)", display: false }
                ],
                throwOnError: false
            });
        }

        // 6. 绑定打印按钮事件 (因为 innerHTML 覆盖后，原来的 onclick 事件绑定会丢失)
        reattachPrintHandlers();

        // 7. 移动端自动关闭侧边栏
        if (window.innerWidth < 1000) {
            document.getElementById('ai-history-drawer').classList.remove('open');
        }
    }
}

// [    辅助函数] 重  绑定气泡上的打印按钮事件
function reattachPrintHandlers() {
    const printBtns = document.querySelectorAll('.ai-bubble-print-btn');
    printBtns.forEach(btn => {
        btn.onclick = function () {
            // 找到父级气泡
            const bubble = this.parentElement;
            // 提取信息 (这里需要根据你的 DOM 结构反向获取，或者简单点，不重  绑定复杂逻辑)
            // 简单的做法：重  解析 DOM 内容
            const userBubble = bubble.previousElementSibling; // 假设上面一个是用户提问
            const userText = userBubble ? userBubble.innerText : "历史记录";

            const reasoningEl = bubble.querySelector('.ai-reasoning-content');
            const answerEl = bubble.querySelector('.ai-answer-content');

            const rText = reasoningEl ? reasoningEl.innerText : "";
            const aHtml = answerEl ? answerEl.innerHTML : "";

            printSingleChatTurn(userText, aHtml, rText);
        };
    });
}

/**
 * 删除单条记录
 */
function deleteAIHistoryItem(event, id) {
    event.stopPropagation(); // 防止触发 onclick 加载
    if (!confirm('确定删除这条记录吗？')) return;

    let history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || "[]");
    history = history.filter(r => r.id !== id);
    localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(history));

    renderAIHistoryList();
}


/**
 *    打印单轮对话 (追问记录)
 */
function printSingleChatTurn(userQuestion, aiAnswerHtml, aiReasoningText) {
    // 1. 获取基本信息 (用于页眉)
    const studentSearch = document.getElementById('ai-student-search');
    const studentName = studentSearch.dataset.selectedName || "学生";
    const subject = document.getElementById('ai-item-subject').value || "综合";

    // 2. 构建思考过程的 HTML (如果在打印时想展示)
    let reasoningHtml = "";
    if (aiReasoningText && aiReasoningText.trim() !== "") {
        reasoningHtml = `
            <div class="print-reasoning">
                <h4>🧠 深度思考过程</h4>
                <div class="reasoning-text">${aiReasoningText.replace(/\n/g, '<br>')}</div>
            </div>
        `;
    }

    // 3. 构建打印页面
    const printHtml = `
        <html>
        <head>
            <title>深度追问记录 - ${studentName}</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
            <style>
                body { font-family: -apple-system, "Segoe UI", sans-serif; padding: 2cm; line-height: 1.6; color: #333; }
                
                /* 页眉 */
                .header { border-bottom: 2px solid #333; margin-bottom: 30px; padding-bottom: 10px; text-align: center; }
                .header h2 { margin: 0; font-size: 20px; }
                .header p { margin: 5px 0 0; color: #666; font-size: 14px; }

                /* 对话样式 */
                .user-box { 
                    background-color: #e3f2fd; 
                    border: 1px solid #bbdefb; 
                    padding: 15px; 
                    border-radius: 8px; 
                    margin-bottom: 20px; 
                    color: #0d47a1; 
                    font-weight: bold;
                }
                .user-label { font-size: 0.8em; color: #1976d2; margin-bottom: 5px; display: block; }

                .ai-box { margin-top: 20px; }
                
                /* 思考过程样式 (打印版) */
                .print-reasoning { 
                    margin: 20px 0; 
                    padding: 15px; 
                    background-color: #f9fafb; 
                    border-left: 4px solid #999; 
                    font-size: 0.9em; 
                    color: #555;
                }
                .print-reasoning h4 { margin: 0 0 10px 0; color: #333; }
                .reasoning-text { white-space: pre-wrap; font-family: monospace; }

                /* 正文样式复刻 */
                h3 { border-left: 4px solid #007bff; padding-left: 10px; }
                strong { background-color: #eee; padding: 0 4px; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { border: 1px solid #ccc; padding: 8px; text-align: center; }
                th { background-color: #f0f0f0; }

                @media print {
                    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>深度追问记录</h2>
                <p>对象：${studentName} | 科目：${subject} | 时间：${new Date().toLocaleString()}</p>
            </div>

            <div class="user-box">
                <span class="user-label">🙋 追问问题：</span>
                ${userQuestion}
            </div>

            <div class="ai-box">
                ${reasoningHtml}
                <div class="ai-content">
                    ${aiAnswerHtml}
                </div>
            </div>
        </body>
        </html>
    `;

    const win = window.open('', '_blank');
    win.document.write(printHtml);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 1000);
}


/**
 * 14.2    范围打印功能 (按对话轮次切片)
 * @param {string} rangeStr - 用户输入的范围字符串，如 "1-3" 或 "2"
 */
function printRangeReport(rangeStr) {
    const contentDiv = document.getElementById('ai-content');
    const historyDiv = document.getElementById('ai-chat-history');

    // --- 1. 把页面内容整理成“轮次”数组 ---
    let rounds = [];

    // [第1轮]：初始报告
    if (contentDiv && contentDiv.innerHTML.trim() !== "") {
        rounds.push({
            type: 'initial',
            html: contentDiv.innerHTML
        });
    }

    // [第2+轮]：追问记录
    // 追问记录在 historyDiv 里是扁平排列的 (User, AI, User, AI...)
    // 我们需要按顺序把它们两两配对
    if (historyDiv) {
        const nodes = Array.from(historyDiv.children);
        let currentRound = { type: 'followup', user: '', ai: '' };
        let hasUser = false;

        nodes.forEach(node => {
            // 识别用户气泡 (浅蓝背景)
            if (node.style.backgroundColor === 'rgb(227, 242, 253)' || node.style.background.includes('e3f2fd')) {
                if (hasUser) {
                    // 如果已经有一个用户问题但没AI回答(异常情况)，先封包
                    rounds.push({ type: 'followup', html: buildFollowUpHtml(currentRound.user, currentRound.ai) });
                    currentRound = { type: 'followup', user: '', ai: '' };
                }
                currentRound.user = node.innerHTML; // 拿取内容
                hasUser = true;
            }
            // 识别 AI 气泡 (灰白背景)
            else if (node.style.backgroundColor === 'rgb(248, 249, 250)' || node.style.background.includes('f8f9fa')) {
                currentRound.ai = node.innerHTML; // 拿取内容
                // 配对完成，推入数组
                rounds.push({ type: 'followup', html: buildFollowUpHtml(currentRound.user, currentRound.ai) });
                hasUser = false;
                currentRound = { type: 'followup', user: '', ai: '' }; // 重置
            }
        });
    }

    // --- 2. 解析用户输入的范围 ---
    // 支持 "1", "1-3", "1,3,5" 格式
    const selectedIndices = new Set();
    const parts = rangeStr.split(/[,，]/); // 支持中英文逗号

    parts.forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) selectedIndices.add(i);
            }
        } else {
            const num = Number(part);
            if (!isNaN(num)) selectedIndices.add(num);
        }
    });

    // --- 3. 拼接需要打印的 HTML ---
    let finalHtml = "";
    let count = 0;

    // 遍历所有轮次 (注意：rounds 数组下标从 0 开始，用户输入从 1 开始)
    rounds.forEach((round, index) => {
        const roundNum = index + 1;
        if (selectedIndices.has(roundNum)) {
            if (round.type === 'initial') {
                finalHtml += `
                    <div class="print-section">
                        <h3 class="section-title">📄 第 1 轮：初始分析报告</h3>
                        ${round.html}
                    </div>
                `;
            } else {
                finalHtml += `
                    <div class="print-section" style="page-break-before: auto;">
                        <h3 class="section-title">💬 第 ${roundNum} 轮：深度追问</h3>
                        ${round.html}
                    </div>
                `;
            }
            count++;
        }
    });

    if (count === 0) {
        alert("输入的范围无效或没有对应的内容！\n当前共有 " + rounds.length + " 轮对话。");
        return;
    }

    // --- 4. 调用打印窗口 (复用之前的样式) ---
    // 获取表头信息
    const studentSearch = document.getElementById('ai-student-search');
    const studentName = studentSearch.dataset.selectedName || "学生";

    const printPage = `
        <html>
        <head>
            <title>选段打印 - ${studentName}</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
            <style>
                body { font-family: "Segoe UI", sans-serif; padding: 2cm; color: #333; line-height: 1.6; }
                .print-header { text-align: center; border-bottom: 2px solid #333; margin-bottom: 20px; padding-bottom: 10px; }
                
                /* 区域样式 */
                .print-section { margin-bottom: 40px; }
                .section-title { background: #eee; padding: 8px 15px; border-left: 5px solid #007bff; margin-bottom: 20px; font-size: 1.1em; }

                /* 气泡样式复刻 (强制打印背景色) */
                .user-bubble-print { 
                    background-color: #e3f2fd !important; 
                    border: 1px solid #bbdefb; color: #0d47a1; 
                    padding: 10px; border-radius: 8px; margin-bottom: 15px; font-weight: bold;
                }
                .ai-bubble-print { 
                    background-color: #f8f9fa !important; 
                    border: 1px solid #dee2e6; padding: 10px; border-radius: 8px; 
                }
                
                /* 隐藏不需要的按钮 */
                .ai-bubble-print-btn, details summary { display: none !important; } 
                /* 打印时默认展开所有折叠框内容 */
                details .ai-reasoning-content { display: block !important; border-left: 3px solid #ccc; padding-left: 10px; margin: 10px 0; color: #666; font-size: 0.9em; }

                @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h2>AI 分析报告 (选段)</h2>
                <p>对象：${studentName} | 打印范围：第 ${rangeStr} 轮</p>
            </div>
            ${finalHtml}
        </body>
        </html>
    `;

    const win = window.open('', '_blank');
    win.document.write(printPage);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 1000);
}

// (内部辅助函数) 构建追问的打印 HTML
function buildFollowUpHtml(userHtml, aiHtml) {
    return `
        <div class="user-bubble-print">🙋 提问：<br>${userHtml}</div>
        <div class="ai-bubble-print">🤖 回复：<br>${aiHtml}</div>
    `;
}


// =====================================================================
//    NEW    模块十二：多列表管理逻辑
// =====================================================================

// 全局变量：当前选中的列表ID
let G_CurrentCollectionId = 'default';
const COLLECTIONS_KEY = 'G_MultiExam_Collections_V2';

async function initMultiCollectionManager() {
    const select = document.getElementById('multi-collection-select');
    const btnNew = document.getElementById('btn-new-collection');
    const btnRename = document.getElementById('btn-rename-collection');
    const btnDelete = document.getElementById('btn-delete-collection');

    try {
        // 1. 数据迁移与加载
        await ensureCollectionsExist();

        // 2. 渲染下拉框
        await renderCollectionSelect();
    } catch (err) {
        console.error("初始化列表管理器失败:", err);
    }

    // 3. 绑定事件 (全部都要改为 async)
    if (select) {
        select.onchange = async () => {
            G_CurrentCollectionId = select.value;
            localStorage.setItem('G_MultiExam_ActiveId', G_CurrentCollectionId);

            // 刷  列表显示
            const data = await loadMultiExamData(); // [修改] await
            renderMultiExamList(data);
            initializeStudentSearch(data);

            // 隐藏报表
            const report = document.getElementById('multi-student-report');
            if (report) report.style.display = 'none';
        };
    }

    if (btnNew) {
        btnNew.onclick = async () => {
            const name = prompt("请输入  列表名称 (例如：高二下学期):");
            if (!name) return;

            const collections = await getCollections(); // [修改] await
            const newId = 'col_' + Date.now();
            collections[newId] = {
                name: name,
                exams: []
            };
            await saveCollections(collections); // [修改] await

            // 切换到  列表
            G_CurrentCollectionId = newId;
            localStorage.setItem('G_MultiExam_ActiveId', newId);

            await renderCollectionSelect(); // [修改] await

            // 刷  界面
            renderMultiExamList([]);
            initializeStudentSearch([]);
            const report = document.getElementById('multi-student-report');
            if (report) report.style.display = 'none';
        };
    }

    if (btnRename) {
        btnRename.onclick = async () => {
            const collections = await getCollections(); // [修改] await
            const current = collections[G_CurrentCollectionId];
            if (!current) return;

            const newName = prompt("重命名列表:", current.name);
            if (newName && newName !== current.name) {
                current.name = newName;
                await saveCollections(collections); // [修改] await
                await renderCollectionSelect(); // [修改] await
            }
        };
    }

    if (btnDelete) {
        btnDelete.onclick = async () => {
            const collections = await getCollections(); // [修改] await
            const keys = Object.keys(collections);
            if (keys.length <= 1) {
                alert("这是最后一个列表，无法删除！");
                return;
            }
            if (!confirm(`确定要删除列表【${collections[G_CurrentCollectionId].name}】及其包含的所有考试数据吗？此操作不可恢复！`)) {
                return;
            }

            delete collections[G_CurrentCollectionId];
            await saveCollections(collections); // [修改] await

            // 切换回第一个可用列表
            G_CurrentCollectionId = Object.keys(collections)[0];
            localStorage.setItem('G_MultiExam_ActiveId', G_CurrentCollectionId);

            await renderCollectionSelect(); // [修改] await

            // 刷  界面
            const data = await loadMultiExamData(); // [修改] await
            renderMultiExamList(data);
            initializeStudentSearch(data);
            const report = document.getElementById('multi-student-report');
            if (report) report.style.display = 'none';
        };
    }

    // 侧边栏 UI 控制逻辑 (保持不变)
    const drawer = document.getElementById('multi-collection-drawer');
    const toggleBtn = document.getElementById('multi-collection-toggle-btn');
    const closeBtn = document.getElementById('multi-collection-close-btn');

    if (toggleBtn && drawer) {
        toggleBtn.onclick = () => { drawer.classList.add('open'); };
        closeBtn.onclick = () => { drawer.classList.remove('open'); };
        if (select) {
            select.addEventListener('change', () => {
                setTimeout(() => drawer.classList.remove('open'), 300);
            });
        }
    }
}

// --- 辅助函数 ---
async function getCollections() {
    // [修改]   加 await
    const json = await localforage.getItem(COLLECTIONS_KEY);
    // localforage 存的是对象，不需要再 JSON.parse，除非你手动 stringify 过
    // 为了兼容旧逻辑，如果你存的时候用了 JSON.stringify，这里就要 parse
    // 建议统一：存对象，取对象。LocalForage 会自动处理。
    if (typeof json === 'string') {
        try { return JSON.parse(json); } catch (e) { return {}; }
    }
    return json || {};
}

async function saveCollections(data) {
    // [修改]   加 await，直接存对象
    await localforage.setItem(COLLECTIONS_KEY, data);
}

async function ensureCollectionsExist() {
    let collections = await getCollections(); // [修改] await

    // 如果是第一次运行  版，或者没有数据
    if (!collections || Object.keys(collections).length === 0) {
        console.log("检测到  环境，正在迁移旧数据...");

        // 尝试迁移旧版数据 (G_MultiExamData)
        // localStorage 是同步的，这里不需要 await
        const oldDataJson = localStorage.getItem('G_MultiExamData');
        const oldData = oldDataJson ? JSON.parse(oldDataJson) : [];

        // 创建默认列表
        collections = {
            'default': {
                name: '默认考试列表',
                exams: oldData
            }
        };
        await saveCollections(collections); // [修改] await
    }

    // 恢复上次选中的ID
    const savedId = localStorage.getItem('G_MultiExam_ActiveId');
    if (savedId && collections[savedId]) {
        G_CurrentCollectionId = savedId;
    } else {
        // 默认选中第一个
        G_CurrentCollectionId = Object.keys(collections)[0];
    }
}

async function renderCollectionSelect() {
    const select = document.getElementById('multi-collection-select');
    if (!select) return;

    // [修改] 必须加 await，否则 collections 是 Promise，无法遍历
    const collections = await getCollections();

    let html = '';
    for (const id in collections) {
        const selected = (id === G_CurrentCollectionId) ? 'selected' : '';
        // 防止 exams 为 undefined
        const count = collections[id].exams ? collections[id].exams.length : 0;
        html += `<option value="${id}" ${selected}>${collections[id].name} (${count}次考试)</option>`;
    }
    select.innerHTML = html;
}

// script.js

/**
 * [通用] 显示下钻模态框
 * @param {string} title - 标题 (例如 "不及格学生名单")
 * @param {Array} students - 学生对象数组
 * @param {string} subject - 当前分析的科目 (用于显示分数)
 */
function showDrillDownModal(title, students, subject = 'totalScore') {
    const modal = document.getElementById('drill-down-modal');
    const titleEl = document.getElementById('drill-down-title');
    const subtitleEl = document.getElementById('drill-down-subtitle');
    const container = document.getElementById('drill-down-table-container');
    const closeBtn = document.getElementById('drill-down-close-btn');
    const exportBtn = document.getElementById('drill-down-export-btn');

    // 1. 设置基本信息
    titleEl.innerText = title;
    subtitleEl.innerText = `共 ${students.length} 人`;

    // 2. 渲染表格
    if (students.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px;">无数据</p>';
    } else {
        const isTotal = (subject === 'totalScore');
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>姓名</th>
                        <th>班级</th>
                        <th>考号</th>
                        <th>${isTotal ? '总分' : subject}</th>
                        <th>班排</th>
                    </tr>
                </thead>
                <tbody>
                    ${students.map(s => `
                        <tr>
                            <td>${s.name}</td>
                            <td>${s.class}</td>
                            <td>${s.id}</td>
                            <td><strong>${isTotal ? s.totalScore : (s.scores[subject] || 0)}</strong></td>
                            <td>${s.rank}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    // 3. 绑定导出按钮
    exportBtn.onclick = () => {
        if (students.length === 0) return;
        // 准备导出数据
        const sheetData = students.map(s => ({
            "姓名": s.name,
            "班级": s.class,
            "考号": s.id,
            "分数": (subject === 'totalScore') ? s.totalScore : (s.scores[subject] || 0),
            "班排": s.rank
        }));
        const ws = XLSX.utils.json_to_sheet(sheetData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "名单");
        XLSX.writeFile(wb, `${title}.xlsx`);
    };

    // 4. 显示模态框
    modal.style.display = 'flex';

    // 5. 绑定关闭
    closeBtn.onclick = () => { modal.style.display = 'none'; };
    // 点击遮罩关闭
    window.onclick = (event) => {
        if (event.target == modal) modal.style.display = 'none';
    };
}


/**
 * [    ] 渲染贡献度分析图 (正负条形图)
 */
function renderContributionChart(elementId, subjects, data, totalDiff) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    const option = {
        title: {
            text: `总分与年级均分差距: ${totalDiff > 0 ? '+' : ''}${totalDiff} 分`,
            left: 'center',
            textStyle: { color: totalDiff >= 0 ? '#28a745' : '#dc3545' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: '{b}: {c} 分'
        },
        grid: { top: 50, bottom: 30 },
        xAxis: {
            type: 'category',
            data: subjects,
            axisLabel: { rotate: 0 },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: '贡献分值',
            axisLabel: { formatter: '{value}' }
        },
        series: [{
            name: '贡献值',
            type: 'bar',
            data: data,
            label: { show: true, position: 'top' },
            itemStyle: {
                color: function (params) {
                    return params.value >= 0 ? '#28a745' : '#dc3545';
                }
            }
        }]
    };
    myChart.setOption(option);
    echartsInstances[elementId] = myChart;
}



//            默认模板库
const DEFAULT_PROMPTS = {
    "default": {
        name: "默认专家风格",
        system: "你是一名专业的中学数据分析师。请使用 Markdown 格式输出。数学公式使用 LaTeX。",
        user: "请分析学生 {{name}} ({{grade}}) 的{{subject}}成绩。\n\n数据背景：\n{{data_context}}\n\n请给出：\n1. 成绩诊断\n2. 归因分析\n3. 提分建议"
    },
    "encouraging": {
        name: "鼓励式沟通 (给家长看)",
        system: "你是一位温暖、富有同理心的资深班主任。你的分析对象是学生家长，语气要委婉、多鼓励，少批评。",
        user: "请为 {{name}} 同学的家长写一份{{subject}}学情反馈。\n\n数据详情：\n{{data_context}}\n\n要求：\n1. 先肯定孩子的努力和亮点（具体到题目或知识点）。\n2. 委婉指出存在的小问题。\n3. 给家长提供配合建议。"
    },
    "strict": {
        name: "严厉诊断 (给学生看)",
        system: "你是一位严厉但负责的学科教练。说话针针见血，不留情面，直接指出漏洞。",
        user: "直接指出 {{name}} 在{{subject}}上的严重失分点。\n\n数据：\n{{data_context}}\n\n告诉我：他到底哪学的不行？接下来该怎么魔鬼训练？"
    }
};

//    在 initAIModule 中调用此函数   
function initPromptManager() {
    const modal = document.getElementById('ai-prompt-modal');
    const openBtn = document.getElementById('ai-prompt-settings-btn');
    const closeBtn = document.getElementById('ai-prompt-close-btn');
    const select = document.getElementById('ai-prompt-select');
    const nameInput = document.getElementById('ai-prompt-name');
    const sysInput = document.getElementById('ai-prompt-system');
    const userInput = document.getElementById('ai-prompt-user');
    const saveBtn = document.getElementById('ai-prompt-save-btn');
    const newBtn = document.getElementById('ai-prompt-new-btn');
    const delBtn = document.getElementById('ai-prompt-delete-btn');

    // 加载模板
    let prompts = JSON.parse(localStorage.getItem('G_AI_Prompts')) || DEFAULT_PROMPTS;

    const renderSelect = () => {
        select.innerHTML = Object.keys(prompts).map(k => `<option value="${k}">${prompts[k].name}</option>`).join('');
        loadTemplate(select.value);
    };

    const loadTemplate = (key) => {
        const t = prompts[key];
        if (t) {
            nameInput.value = t.name;
            sysInput.value = t.system;
            userInput.value = t.user;
        }
    };

    openBtn.onclick = () => { modal.style.display = 'flex'; renderSelect(); };
    closeBtn.onclick = () => { modal.style.display = 'none'; };
    select.onchange = () => loadTemplate(select.value);

    newBtn.onclick = () => {
        const id = 'custom_' + Date.now();
        prompts[id] = { name: "  模板", system: "", user: "" };
        renderSelect();
        select.value = id;
        loadTemplate(id);
    };

    saveBtn.onclick = () => {
        const key = select.value;
        prompts[key] = {
            name: nameInput.value,
            system: sysInput.value,
            user: userInput.value
        };
        localStorage.setItem('G_AI_Prompts', JSON.stringify(prompts));
        // 保存当前选中的模板ID，供生成时使用
        localStorage.setItem('G_AI_ActivePromptId', key);
        alert("模板已保存");
        
        // --- ✅     关闭指令 ---
        modal.style.display = 'none'; 
    };

    // ============================================================
    //    修复    添加删除按钮的逻辑
    // ============================================================
    delBtn.onclick = () => {
        const key = select.value;

        // 1. 保护系统默认模板，不允许删除
        if (DEFAULT_PROMPTS[key]) {
            alert("系统默认模板无法删除！");
            return;
        }

        // 2. 删除确认
        if (!confirm("确定要删除这个自定义模板吗？\n此操作不可恢复。")) return;

        // 3. 执行删除
        delete prompts[key];

        // 4. 保存更  后的数据到本地存储
        localStorage.setItem('G_AI_Prompts', JSON.stringify(prompts));

        // 5. 检查逻辑：如果删除了当前正在使用的模板，重置为默认
        if (localStorage.getItem('G_AI_ActivePromptId') === key) {
            localStorage.setItem('G_AI_ActivePromptId', 'default');
        }

        // 6. 刷   UI
        alert("✅ 模板已删除");
        renderSelect(); // 重  渲染下拉框

        // 7. 自动切换回默认模板
        select.value = 'default';
        loadTemplate('default');
    };

    // 初始化
    renderSelect();
}
/**
 * [旗舰完整版] 模块十四：目标与规划
 * - 支持规划列表（批次）管理
 * - 支持独立基准/复盘数据源导入
 * - 支持详情弹窗对比与滑动
 * - 支持数据来源标识打印
 */
async function renderGoalSetting(container, activeData, stats) {
    // ------------------------------------------------------
    // 0. 初始化与数据加载
    // ------------------------------------------------------

    // 默认基准数据使用全局导入的数据
    if (!G_GoalBaselineData) G_GoalBaselineData = activeData;

    // 记录复盘数据来源名称 (用于显示和打印)
    let currentOutcomeSourceName = "未导入";
    // 尝试检测是否已有数据
    if (G_GoalOutcomeData && G_GoalOutcomeData.length > 0) {
        currentOutcomeSourceName = localStorage.getItem('G_GoalOutcome_FileName') || "已导入数据";
    }

    // 加载存档和批次信息
    let allArchives = await localforage.getItem('G_Goal_Archives') || {};
    let sessionMeta = await localforage.getItem('G_Goal_Session_Meta') || [];

    // 初始化默认批次
    if (sessionMeta.length === 0) {
        sessionMeta = [{ id: 'default_session', name: '默认规划列表', createDate: new Date().toLocaleString() }];
        await localforage.setItem('G_Goal_Session_Meta', sessionMeta);
    }

    // 获取当前选中的批次ID
    let currentSessionId = localStorage.getItem('G_Goal_Current_Session_ID') || sessionMeta[0].id;
    if (!sessionMeta.find(s => s.id === currentSessionId)) currentSessionId = sessionMeta[0].id;

    // 局部变量
    let currentStudent = null;
    let G_EditingPlanState = null;
    let currentPlanMode = 'total';
    let currentSubject = G_DynamicSubjectList[0];
    let currentStrategy = null;
    let currentTargetData = { val: 0, type: 'score' };

    // ------------------------------------------------------
    // 1. 渲染界面框架
    // ------------------------------------------------------
    container.innerHTML = `
        <h2>🎯 模块十四：目标规划与复盘管理</h2>
        
        <div class="main-card-wrapper" style="background: #f8f9fa; border: 1px dashed #ccc; margin-bottom: 20px; padding: 15px;">
            <h4 style="margin: 0 0 15px 0; color: #555; display:flex; justify-content:space-between;">
                <span>📂 数据源配置 (Data Sources)</span>
                <span style="font-size:0.8em; font-weight:normal; color:#999;">支持从“数据中心”选择历史成绩</span>
            </h4>
            <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 250px; background:white; padding:10px; border-radius:8px; border:1px solid #eee;">
                    <div style="font-weight:bold; margin-bottom:5px; color:#6f42c1;">1. 基准成绩 (制定规划用)</div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button id="btn-import-baseline" class="sidebar-button" style="background-color: #6f42c1; font-size: 0.9em; width: 100%;">📥 导入/选择数据</button>
                        <input type="file" id="goal-upload-baseline" accept=".xlsx, .xls, .csv" style="display: none;">
                    </div>
                    <div id="goal-status-baseline" style="font-size: 0.85em; color: #666; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        当前: 系统默认数据 (${activeData.length}人)
                    </div>
                </div>
                <div style="flex: 1; min-width: 250px; background:white; padding:10px; border-radius:8px; border:1px solid #eee;">
                    <div style="font-weight:bold; margin-bottom:5px; color:#20c997;">2. 达成成绩 (复盘对比用)</div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button id="btn-import-outcome" class="sidebar-button" style="background-color: #20c997; font-size: 0.9em; width: 100%;">📥 导入/选择数据</button>
                        <input type="file" id="goal-upload-outcome" accept=".xlsx, .xls, .csv" style="display: none;">
                    </div>
                    <div id="goal-status-outcome" style="font-size: 0.85em; color: #dc3545; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        当前: ${currentOutcomeSourceName}
                    </div>
                </div>
            </div>
        </div>

        <div style="margin-bottom: 20px; border-bottom: 2px solid #eee; display: flex; gap: 20px;">
            <button class="tab-btn active" data-tab="create" style="padding: 10px 20px; font-weight: bold; cursor: pointer; border:none; background:none; border-bottom: 3px solid var(--primary-color); color: var(--primary-color);">
                ✍️   建/修改规划
            </button>
            <button class="tab-btn" data-tab="manage" style="padding: 10px 20px; font-weight: bold; cursor: pointer; border:none; background:none; color: #666; border-bottom: 3px solid transparent;">
                📋 规划管理大厅
            </button>
        </div>

        <div id="goal-tab-create" class="tab-content">
            <div class="main-card-wrapper" style="margin-bottom: 20px; padding: 15px;">
                <div style="display:flex; align-items:center; gap:15px; margin-bottom:15px;">
                    <label style="font-weight:bold;">选择班级 (基于基准表):</label>
                    <select id="goal-class-select" class="sidebar-select" style="width:auto; min-width:150px; font-weight:bold; color:var(--primary-color);"></select>

                    <input type="text" id="goal-fast-search" placeholder="🔍 快速找人 (姓名/考号)" class="sidebar-select" style="width: 180px;">
                    <span style="color:#999; font-size:0.9em;">(✅ = 当前列表内已有规划)</span>
                </div>
                <div id="goal-student-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; max-height: 150px; overflow-y: auto; padding-right:5px;"></div>
            </div>

            <div id="goal-workspace" style="display: none;">
                <div class="controls-bar" style="background: #f0f7ff; border: 1px solid #cce5ff; padding: 10px 20px; justify-content: space-between;">
                    <div style="display:flex; align-items:center; gap:20px;">
                        <label style="font-weight:bold; color:#004085;">规划模式:</label>
                        <label style="cursor: pointer; display: flex; align-items: center;">
                            <input type="radio" name="plan-mode" value="total" checked style="margin-right: 5px;"> 全科/班主任
                        </label>
                        <label style="cursor: pointer; display: flex; align-items: center;">
                            <input type="radio" name="plan-mode" value="single" style="margin-right: 5px;"> 单科/科任
                        </label>
                    </div>
                    <div id="goal-single-subject-select-wrapper" style="display:none;">
                        <select id="goal-single-subject-select" class="sidebar-select" style="width:auto;">
                            ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                        </select>
                    </div>
                </div>
                
                <div class="main-card-wrapper" style="margin-bottom: 20px; border-left: 5px solid var(--color-purple);">
                    <div style="display:flex; align-items:center; gap:15px; flex-wrap:wrap;">
                        <span id="goal-target-label" style="font-weight:bold;">设定目标:</span>
                        <select id="goal-target-type" class="sidebar-select" style="width:120px;">
                            <option value="score">分数 (Score)</option>
                            <option value="rank">年级排名 (Rank)</option>
                        </select>
                        <input type="number" id="goal-target-val" class="sidebar-select" style="width:100px;" placeholder="目标值">
                        <button id="goal-calc-btn" class="sidebar-button" style="background-color: var(--color-purple);">🚀 生成规划</button>
                    </div>
                    <p id="goal-current-info" style="margin-top:10px; color:#666; font-size:0.9em;"></p>
                    <div style="font-size:0.85em; color:#999; text-align:right;">
                        当前将保存至列表：<span id="goal-current-session-label" style="font-weight:bold; color:#333;">...</span>
                    </div>
                </div>

                <div id="goal-result-area" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">📊 规划预览</h3>
                        <div style="display: flex; gap: 10px;">
                            <button id="goal-save-btn" class="sidebar-button" style="background-color: #28a745;">💾 保存并标记</button>
                            <button id="goal-print-btn" class="sidebar-button" style="background-color: var(--color-blue);">🖨️ 打印规划书</button>
                        </div>
                    </div>
                    <div id="goal-result-kpi" class="kpi-grid"></div>
                    <div class="table-container" id="goal-result-table"></div>
                    <div id="goal-chart-wrapper" class="dashboard-chart-grid-2x2" style="margin-top:20px;">
                        <div class="main-card-wrapper"><div class="chart-container" id="goal-waterfall-chart"></div></div>
                        <div class="main-card-wrapper"><div class="chart-container" id="goal-radar-chart"></div></div>
                    </div>
                </div>
            </div>
        </div>

        <div id="goal-tab-manage" class="tab-content" style="display: none;">
            <div class="main-card-wrapper" style="margin-bottom: 20px; background: #fffbf0; border: 1px solid #ffeebb;">
                <div style="display:flex; align-items:center; gap:15px; flex-wrap:wrap;">
                    <label style="font-weight:bold; font-size:1.1em;">📁 当前规划列表 (容器):</label>
                    <select id="goal-session-select" class="sidebar-select" style="width:auto; min-width:200px; font-weight:bold;"></select>
                    <button id="btn-new-session" class="sidebar-button" style="background-color:#fd7e14;">➕   建列表</button>
                    <button id="btn-rename-session" class="sidebar-button" style="background-color:#17a2b8;">✏️ 重命名</button>
                    <button id="btn-delete-session" class="sidebar-button" style="background-color:#dc3545;">🗑️ 删除列表</button>
                </div>
            </div>

            <div class="main-card-wrapper">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h4>📋 学生规划档案 (当前列表内)</h4>
                    <button id="goal-manage-refresh" class="sidebar-button" style="font-size:0.8em; padding:5px 10px;">🔄 刷  列表</button>
                </div>
                <div class="table-container" style="max-height: 600px; overflow-y: auto;">
                    <table id="goal-manage-table">
                        <thead>
                            <tr>
                                <th>班级</th>
                                <th>姓名</th>
                                <th>规划名称 (点击查看详情)</th>
                                <th>类型</th>
                                <th>目标</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="goal-manage-tbody"></tbody>
                    </table>
                </div>
            </div>

            <div id="goal-review-panel" style="display:none; margin-top:20px; border-top:2px dashed #ccc; padding-top:20px;">
                <h3 style="color:var(--primary-color);">🧐 规划复盘报告</h3>
                <div class="main-card-wrapper" style="margin-bottom:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 style="margin:0; text-align:left;">📈 规划达成率趋势</h4>
                        <div style="display:flex; gap:15px; font-size:0.9em; background:#f1f3f5; padding:5px 10px; border-radius:20px;">
                            <label style="cursor:pointer;"><input type="radio" name="goal-trend-mode" value="student" checked> 👤 当前学生</label>
                            <label style="cursor:pointer;"><input type="radio" name="goal-trend-mode" value="all"> 👥 全列表平均</label>
                        </div>
                    </div>
                    <div class="chart-container" id="goal-trend-line-chart" style="height: 350px;"></div>
                </div>
                <div id="goal-review-content"></div>
            </div>
        </div>

        <div id="goal-detail-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content" style="max-width: 950px; width: 90%; max-height: 90vh; display: flex; flex-direction: column; padding: 0;">
                <div class="modal-header" style="padding: 15px 20px; border-bottom: 1px solid #eee;">
                    <h3 id="goal-detail-title" style="margin:0;">规划详情回顾</h3>
                    <span onclick="document.getElementById('goal-detail-modal').style.display='none'" class="modal-close-btn">&times;</span>
                </div>
                
                <div class="modal-body" style="overflow-y: auto; flex: 1; padding: 20px;">
                    <div id="goal-detail-alert" style="display:none; background:#fff3cd; color:#856404; padding:10px; margin-bottom:15px; border-radius:4px; font-size:0.9em;"></div>
                    
                    <div id="goal-detail-source-info"></div>

                    <div class="kpi-grid" id="goal-detail-kpi"></div>
                    <div class="table-container" id="goal-detail-table" style="margin-bottom: 20px;"></div>
                    <div class="dashboard-chart-grid-2x2">
                        <div class="main-card-wrapper">
                            <h4 style="margin:0 0 10px 0; text-align:center;">📊 规划提分路径 (瀑布图)</h4>
                            <div class="chart-container" id="goal-detail-waterfall-chart" style="height: 350px;"></div>
                        </div>
                        <div class="main-card-wrapper">
                            <h4 style="margin:0 0 10px 0; text-align:center;">🕸️ 现状 vs 目标 vs 实际 (雷达图)</h4>
                            <div class="chart-container" id="goal-detail-radar-chart" style="height: 350px;"></div>
                        </div>
                    </div>
                </div>
                
                <div class="modal-footer" style="padding: 15px 20px; border-top: 1px solid #eee; display:flex; justify-content:flex-end; gap:10px;">
                    <button id="goal-detail-print-btn" class="sidebar-button" style="background-color: var(--color-blue);">🖨️ 打印详情单</button>
                    <button class="sidebar-button" style="background-color: #6c757d;" onclick="document.getElementById('goal-detail-modal').style.display='none'">关闭</button>
                </div>
            </div>
        </div>
    `;

    // ------------------------------------------------------
    // 2. 数据源钩子与事件
    // ------------------------------------------------------
    document.getElementById('btn-import-baseline').addEventListener('click', () => { G_CurrentImportType = 'goal-baseline'; document.getElementById('import-modal-title').innerText = '选择“基准成绩”'; openImportModal(); });
    document.getElementById('btn-import-outcome').addEventListener('click', () => { G_CurrentImportType = 'goal-outcome'; document.getElementById('import-modal-title').innerText = '选择“达成成绩”'; openImportModal(); });

    // 全局数据刷  回调
    window.refreshGoalDataSourceUI = (type, fileName, data) => {
        if (type === 'baseline') {
            document.getElementById('goal-status-baseline').innerHTML = `✅ 已导入: <strong>${fileName}</strong> (${data.length}人)`;
            document.getElementById('goal-status-baseline').style.color = "#28a745";
            refreshClassSelector();
            document.getElementById('goal-workspace').style.display = 'none';
        } else if (type === 'outcome') {
            //    更  来源名
            currentOutcomeSourceName = fileName;
            // 保存到本地防止刷  丢失
            localStorage.setItem('G_GoalOutcome_FileName', fileName);

            document.getElementById('goal-status-outcome').innerHTML = `✅ 已导入: <strong>${fileName}</strong> (${data.length}人)`;
            document.getElementById('goal-status-outcome').style.color = "#28a745";
        }
    };

    // 文件控件监听
    document.getElementById('goal-upload-baseline').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const { processedData } = await loadExcelData(file); G_GoalBaselineData = addSubjectRanksToData(processedData); window.refreshGoalDataSourceUI('baseline', file.name, G_GoalBaselineData); } catch (err) { alert(err.message); } });
    document.getElementById('goal-upload-outcome').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const { processedData } = await loadExcelData(file); G_GoalOutcomeData = addSubjectRanksToData(processedData); window.refreshGoalDataSourceUI('outcome', file.name, G_GoalOutcomeData); } catch (err) { alert(err.message); } });

    // ------------------------------------------------------
    // 3. 批次管理逻辑
    // ------------------------------------------------------
    const sessionSelect = document.getElementById('goal-session-select');
    const sessionLabel = document.getElementById('goal-current-session-label');

    function renderSessionSelect() {
        sessionSelect.innerHTML = sessionMeta.map(s => `<option value="${s.id}" ${s.id === currentSessionId ? 'selected' : ''}>${s.name}</option>`).join('');
        const currentName = sessionMeta.find(s => s.id === currentSessionId)?.name || '未知';
        if (sessionLabel) sessionLabel.innerText = currentName;
    }
    renderSessionSelect();

    sessionSelect.addEventListener('change', () => { currentSessionId = sessionSelect.value; localStorage.setItem('G_Goal_Current_Session_ID', currentSessionId); renderManageTable(); refreshClassSelector(); if (sessionLabel) sessionLabel.innerText = sessionSelect.options[sessionSelect.selectedIndex].text; });
    document.getElementById('btn-new-session').addEventListener('click', async () => { const name = prompt("  列表名称:"); if (!name) return; const newId = 'session_' + Date.now(); sessionMeta.unshift({ id: newId, name: name, createDate: new Date().toLocaleString() }); await localforage.setItem('G_Goal_Session_Meta', sessionMeta); currentSessionId = newId; localStorage.setItem('G_Goal_Current_Session_ID', currentSessionId); renderSessionSelect(); renderManageTable(); });
    document.getElementById('btn-rename-session').addEventListener('click', async () => { const current = sessionMeta.find(s => s.id === currentSessionId); if (!current) return; const newName = prompt("重命名:", current.name); if (newName) { current.name = newName; await localforage.setItem('G_Goal_Session_Meta', sessionMeta); renderSessionSelect(); } });
    document.getElementById('btn-delete-session').addEventListener('click', async () => { if (sessionMeta.length <= 1) { alert("至少保留一个!"); return; } if (!confirm("确定删除?")) return; sessionMeta = sessionMeta.filter(s => s.id !== currentSessionId); await localforage.setItem('G_Goal_Session_Meta', sessionMeta); for (const sid of Object.keys(allArchives)) { allArchives[sid] = allArchives[sid].filter(r => r.sessionId !== currentSessionId); } await localforage.setItem('G_Goal_Archives', allArchives); currentSessionId = sessionMeta[0].id; localStorage.setItem('G_Goal_Current_Session_ID', currentSessionId); renderSessionSelect(); renderManageTable(); });

    // ------------------------------------------------------
    // 4.   建规划逻辑 (Tab 1)
    // ------------------------------------------------------
    function refreshClassSelector() { const classSelect = document.getElementById('goal-class-select'); const studentGrid = document.getElementById('goal-student-grid'); studentGrid.innerHTML = ''; if (!G_GoalBaselineData || G_GoalBaselineData.length === 0) return; const classes = [...new Set(G_GoalBaselineData.map(s => s.class))].sort(); classSelect.innerHTML = `<option value="">-- 请选择班级 --</option>` + classes.map(c => `<option value="${c}">${c}</option>`).join(''); }
    refreshClassSelector();

    // 【在这里插入    代码】 快速搜索监听
    document.getElementById('goal-fast-search').addEventListener('input', (e) => {
        const term = e.target.value.trim().toLowerCase();
        const grid = document.getElementById('goal-student-grid');

        // 如果搜索框清空，这就恢复当前选中班级的视图 (触发一次 change 事件)
        if (!term) {
            document.getElementById('goal-class-select').dispatchEvent(new Event('change'));
            return;
        }

        // 在所有基准数据中搜索
        const matches = G_GoalBaselineData.filter(s =>
            s.name.toLowerCase().includes(term) || String(s.id).includes(term)
        );

        if (matches.length === 0) {
            grid.innerHTML = '<p style="color:#999; padding:10px;">未找到匹配的学生</p>';
            return;
        }

        // 渲染搜索结果 (复用之前的按钮样式逻辑)
        grid.innerHTML = matches.map(s => {
            let hasPlan = false;
            if (allArchives[s.id]) hasPlan = allArchives[s.id].some(r => r.sessionId === currentSessionId);
            const mark = hasPlan ? `<span style="color:#28a745; font-weight:bold;">✅</span>` : '';

            // 显示班级信息，方便区分同名
            return `<button class="sidebar-button goal-student-btn" data-id="${s.id}" 
                style="background-color:#fff; color:#333; border:1px solid #dee2e6; justify-content:center; font-size:0.9em; flex-direction:column; gap:2px;">
                <span>${s.name} ${mark}</span>
                <span style="font-size:0.75em; color:#999;">${s.class}</span>
            </button>`;
        }).join('');

        // 重  绑定点击事件
        document.querySelectorAll('.goal-student-btn').forEach(btn => {
            btn.addEventListener('click', () => selectStudent(btn.dataset.id));
        });
    });


    document.getElementById('goal-class-select').addEventListener('change', (e) => { const cls = e.target.value; const grid = document.getElementById('goal-student-grid'); if (!cls) { grid.innerHTML = ''; return; } const studentsInClass = G_GoalBaselineData.filter(s => s.class === cls); grid.innerHTML = studentsInClass.map(s => { let hasPlan = false; if (allArchives[s.id]) hasPlan = allArchives[s.id].some(r => r.sessionId === currentSessionId); const mark = hasPlan ? `<span style="color:#28a745; font-weight:bold;">✅</span>` : ''; return `<button class="sidebar-button goal-student-btn" data-id="${s.id}" style="background-color:#fff; color:#333; border:1px solid #dee2e6; justify-content:center; font-size:0.9em;">${s.name} ${mark}</button>`; }).join(''); document.querySelectorAll('.goal-student-btn').forEach(btn => btn.addEventListener('click', () => selectStudent(btn.dataset.id))); document.getElementById('goal-fast-search').value = ''; });
    function selectStudent(id) {
        
        if (G_EditingPlanState && String(G_EditingPlanState.sid) !== String(id)) {
            G_EditingPlanState = null;
            const saveBtn = document.getElementById('goal-save-btn');
            saveBtn.innerHTML = "💾 保存并标记";
            saveBtn.style.backgroundColor = "#28a745"; // 恢复绿色
            document.getElementById('goal-target-val').value = ""; // 清空输入
        }
        
        currentStudent = G_GoalBaselineData.find(s => String(s.id) === String(id)); if (!currentStudent) return; document.querySelectorAll('.goal-student-btn').forEach(b => { b.style.backgroundColor = '#fff'; b.style.color = '#333'; }); const activeBtn = document.querySelector(`.goal-student-btn[data-id="${id}"]`); if (activeBtn) { activeBtn.style.backgroundColor = '#007bff'; activeBtn.style.color = '#fff'; } document.getElementById('goal-workspace').style.display = 'block'; document.getElementById('goal-result-area').style.display = 'none'; updateCurrentInfoLabel(); }

    document.getElementsByName('plan-mode').forEach(r => r.addEventListener('change', (e) => { currentPlanMode = e.target.value; document.getElementById('goal-single-subject-select-wrapper').style.display = (currentPlanMode === 'single') ? 'block' : 'none'; document.getElementById('goal-chart-wrapper').style.display = (currentPlanMode === 'total') ? 'grid' : 'none'; updateCurrentInfoLabel(); }));
    document.getElementById('goal-single-subject-select').addEventListener('change', (e) => { currentSubject = e.target.value; updateCurrentInfoLabel(); });
    document.getElementById('goal-target-type').addEventListener('change', updateCurrentInfoLabel);
    // 更新当前状态文字
    function updateCurrentInfoLabel() { 
        if (!currentStudent) return; 
        const infoEl = document.getElementById('goal-current-info'); 
        const targetType = document.getElementById('goal-target-type').value; // 获取当前选的是“分数”还是“排名”

        if (currentPlanMode === 'total') {
             // 全科模式：保持显示总分和总排名
             infoEl.innerHTML = `学生：<strong>${currentStudent.name}</strong> | 基准总分：${currentStudent.totalScore} | 基准年排：${currentStudent.gradeRank}`; 
        } else { 
             // 单科模式：根据目标类型智能切换
             const score = currentStudent.scores[currentSubject] || 0; 
             
             if (targetType === 'rank') {
                 // 如果目标设定为“排名”，则显示基准排名
                 // (防御性检查：防止 gradeRanks 不存在)
                 const rank = (currentStudent.gradeRanks && currentStudent.gradeRanks[currentSubject]) 
                              ? currentStudent.gradeRanks[currentSubject] 
                              : '-';
                 infoEl.innerHTML = `学生：<strong>${currentStudent.name}</strong> | 科目：<strong>${currentSubject}</strong> | <span style="color:#fd7e14; font-weight:bold;">基准年排：${rank}</span> <span style="color:#999; font-size:0.9em;">(当前分: ${score})</span>`; 
             } else {
                 // 如果目标设定为“分数”，显示基准分数
                 infoEl.innerHTML = `学生：<strong>${currentStudent.name}</strong> | 科目：<strong>${currentSubject}</strong> | 基准分：${score}`; 
             }
        } 
    }
    // 计算生成
    document.getElementById('goal-calc-btn').addEventListener('click', () => {
        if (!currentStudent) return;
        const val = parseFloat(document.getElementById('goal-target-val').value);
        const type = document.getElementById('goal-target-type').value;
        if (!val) { alert("请输入目标值"); return; }
        currentTargetData = { val, type };
        let details = [], targetTotal = 0, displayGap = 0;

        if (currentPlanMode === 'single') {
            let targetScore = val;
            const currentScore = currentStudent.scores[currentSubject] || 0;
            const fullScore = G_SubjectConfigs[currentSubject] ? G_SubjectConfigs[currentSubject].full : 100;
            if (type === 'rank') {
                const allScores = G_GoalBaselineData.map(s => s.scores[currentSubject]).filter(v => typeof v === 'number').sort((a, b) => b - a);
                const idx = Math.min(Math.max(0, Math.floor(val) - 1), allScores.length - 1);
                targetScore = allScores[idx] || 0;
            }
            if (targetScore > fullScore) targetScore = fullScore;
            details.push({ subject: currentSubject, current: currentScore, target: targetScore, gain: targetScore - currentScore, room: fullScore - currentScore, difficultyText: getDifficultyText(fullScore - currentScore, currentScore, fullScore) });
            targetTotal = targetScore; displayGap = targetScore - currentScore;
        } else {
            let targetScoreVal = val;
            if (type === 'rank') {
                const allTotals = G_GoalBaselineData.map(s => s.totalScore).filter(v => typeof v === 'number').sort((a, b) => b - a);
                const idx = Math.min(Math.max(0, Math.floor(val) - 1), allTotals.length - 1);
                targetScoreVal = allTotals[idx] || 0;
            }
            const baselineStats = calculateAllStatistics(G_GoalBaselineData);
            const allocation = calculateSmartAllocation(currentStudent, targetScoreVal, G_GoalBaselineData, baselineStats);
            details.push(...allocation.details);
            targetTotal = targetScoreVal; displayGap = allocation.totalDeficit;
        }

        currentStrategy = { mode: currentPlanMode, subject: currentPlanMode === 'single' ? currentSubject : 'Total', targetType: type, targetVal: val, targetScoreCalculated: targetTotal, details: details, totalDeficit: displayGap };
        renderGoalResultsUI(currentStudent, currentStrategy, displayGap);
    });

    function renderGoalResultsUI(student, strategy, gap) {
        document.getElementById('goal-result-area').style.display = 'block';
        const kpi = document.getElementById('goal-result-kpi');
        const gapText = gap > 0 ? `需提升 ${gap.toFixed(1)}` : `已达标`;
        const modeText = strategy.mode === 'total' ? "总分" : strategy.subject;
        kpi.innerHTML = `<div class="kpi-card"><h3>目标${modeText}</h3><div class="value" style="color:var(--color-purple)">${strategy.targetScoreCalculated.toFixed(1)}</div></div><div class="kpi-card"><h3>差距</h3><div class="value" style="font-size:1.5em; color:${gap > 0 ? '#dc3545' : '#28a745'}">${gapText}</div></div>`;
        document.getElementById('goal-result-table').innerHTML = `<table><thead><tr><th>科目</th><th>基准分</th><th>目标</th><th style="color:purple">需提分</th><th>策略</th></tr></thead><tbody>${strategy.details.map(d => `<tr><td>${d.subject}</td><td>${d.current}</td><td><strong>${d.target.toFixed(1)}</strong></td><td style="font-weight:bold; color:${d.gain > 0 ? 'purple' : '#999'}">+${d.gain.toFixed(1)}</td><td>${d.difficultyText}</td></tr>`).join('')}</tbody></table>`;
        if (strategy.mode === 'total') {
            renderGoalWaterfall('goal-waterfall-chart', student.totalScore, strategy.targetScoreCalculated, strategy.details);
            renderGoalRadar('goal-radar-chart', student, strategy.details);
        }
    }

    // 保存规划
    document.getElementById('goal-save-btn').addEventListener('click', async () => {
        if (!currentStudent || !currentStrategy) return;
        const planName = prompt("规划名称:", "目标-" + new Date().toLocaleDateString());
        if (!planName) return;

        let baselineSource = "系统默认数据";
        const baselineStatusText = document.getElementById('goal-status-baseline').innerText;
        if (baselineStatusText.includes('已导入')) { const match = document.getElementById('goal-status-baseline').querySelector('strong'); if (match) baselineSource = match.innerText; }

        const record = { id: Date.now(), sessionId: currentSessionId, studentId: currentStudent.id, studentName: currentStudent.name, className: currentStudent.class, name: planName, createDate: new Date().toLocaleString(), baselineSource: baselineSource, strategy: currentStrategy };
        if (!allArchives[currentStudent.id]) allArchives[currentStudent.id] = [];
        allArchives[currentStudent.id].unshift(record);
        await localforage.setItem('G_Goal_Archives', allArchives);
        alert("✅ 规划已保存！");
        const btn = document.querySelector(`.goal-student-btn[data-id="${currentStudent.id}"]`);
        if (btn && !btn.innerHTML.includes('✅')) btn.innerHTML += ` <span style="color:#28a745; font-weight:bold;">✅</span>`;
    });

    document.getElementById('goal-print-btn').addEventListener('click', () => { if (!currentStudent || !currentStrategy) return; let printRank = currentTargetData.type === 'rank' ? currentTargetData.val : '-'; startGoalPrintJob(currentStudent, currentStrategy.targetScoreCalculated, printRank, currentStrategy); });

    // ------------------------------------------------------
    // 5. 管理大厅逻辑 (Tab 2)
    // ------------------------------------------------------
    const tabManage = document.querySelector('button[data-tab="manage"]');
    const tabCreate = document.querySelector('button[data-tab="create"]');
    tabManage.addEventListener('click', () => { document.getElementById('goal-tab-create').style.display = 'none'; document.getElementById('goal-tab-manage').style.display = 'block'; tabManage.classList.add('active'); tabManage.style.borderBottomColor = 'var(--primary-color)'; tabManage.style.color = 'var(--primary-color)'; tabCreate.classList.remove('active'); tabCreate.style.borderBottomColor = 'transparent'; tabCreate.style.color = '#666'; renderManageTable(); });
    tabCreate.addEventListener('click', () => { document.getElementById('goal-tab-create').style.display = 'block'; document.getElementById('goal-tab-manage').style.display = 'none'; tabCreate.classList.add('active'); tabCreate.style.borderBottomColor = 'var(--primary-color)'; tabCreate.style.color = 'var(--primary-color)'; tabManage.classList.remove('active'); tabManage.style.borderBottomColor = 'transparent'; tabManage.style.color = '#666'; });
    document.getElementById('goal-manage-refresh').addEventListener('click', renderManageTable);

// [升级版] 渲染管理大厅表格 (支持点击表头排序)
    async function renderManageTable() {
        // 1. 初始化排序状态 (全局持久化，防止切换Tab丢失)
        if (typeof window.G_GoalManageSort === 'undefined') {
            window.G_GoalManageSort = { key: 'id', direction: 'desc' }; // 默认按创建时间倒序
        }

        // 2. 动态升级表头 (注入排序功能)
        const thead = document.querySelector('#goal-manage-table thead');
        if (thead && !thead.dataset.sortEnabled) {
            thead.dataset.sortEnabled = "true";
            thead.innerHTML = `
                <tr>
                    <th data-sort="className" style="cursor:pointer; user-select:none;">班级 ⇅</th>
                    <th data-sort="studentName" style="cursor:pointer; user-select:none;">姓名 ⇅</th>
                    <th data-sort="name" style="cursor:pointer; user-select:none;">规划名称 ⇅</th>
                    <th data-sort="mode" style="cursor:pointer; user-select:none;">类型 ⇅</th>
                    <th data-sort="target" style="cursor:pointer; user-select:none;">目标 ⇅</th>
                    <th>操作</th>
                </tr>
            `;
            // 绑定点击事件
            thead.addEventListener('click', (e) => {
                const th = e.target.closest('th');
                if (!th || !th.dataset.sort) return;
                const key = th.dataset.sort;
                
                // 切换排序逻辑
                if (window.G_GoalManageSort.key === key) {
                    window.G_GoalManageSort.direction = window.G_GoalManageSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    window.G_GoalManageSort.key = key;
                    window.G_GoalManageSort.direction = 'desc'; // 默认降序
                }
                // 重新渲染表格
                renderManageTable();
            });
        }

        // 3. 更新表头样式 (高亮当前排序列)
        if (thead) {
            const ths = thead.querySelectorAll('th[data-sort]');
            ths.forEach(th => {
                th.style.color = '';
                // 重置图标
                let text = th.innerText.replace(/[↑↓⇅]/g, '').trim();
                th.innerText = text + ' ⇅';
                
                if (th.dataset.sort === window.G_GoalManageSort.key) {
                    th.style.color = '#007bff'; // 高亮颜色
                    const icon = window.G_GoalManageSort.direction === 'asc' ? ' ↑' : ' ↓';
                    th.innerText = text + icon;
                }
            });
        }

        // 4. 获取并整理数据
        allArchives = await localforage.getItem('G_Goal_Archives') || {};
        const tbody = document.getElementById('goal-manage-tbody');
        const rows = [];
        
        Object.keys(allArchives).forEach(sid => { 
            if (Array.isArray(allArchives[sid])) { 
                allArchives[sid].forEach((plan, idx) => { 
                    if (plan.sessionId === currentSessionId || (!plan.sessionId && currentSessionId === sessionMeta[0].id)) { 
                        rows.push({ ...plan, idx, sid }); 
                    } 
                }); 
            } 
        });
        
        if (rows.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">当前列表 [${sessionLabel.innerText}] 暂无记录</td></tr>`; 
            return; 
        }
        
        // 5. [核心] 执行排序
        const { key, direction } = window.G_GoalManageSort;
        rows.sort((a, b) => {
            let valA, valB;
            
            // 提取排序值
            if (key === 'target') {
                // 目标值排序 (优先用计算后的分数，保证排名和分数能混合比较)
                valA = a.strategy.targetScoreCalculated || 0;
                valB = b.strategy.targetScoreCalculated || 0;
            } else if (key === 'mode') {
                valA = a.strategy.mode; // 'total' or 'single'
                valB = b.strategy.mode;
            } else if (key === 'id') {
                valA = a.id; valB = b.id; // 创建时间
            } else {
                // 班级、姓名、规划名称
                valA = a[key] || ''; 
                valB = b[key] || '';
            }
            
            // 执行比较
            if (typeof valA === 'string') {
                return direction === 'asc' ? valA.localeCompare(valB, 'zh-CN') : valB.localeCompare(valA, 'zh-CN');
            } else {
                return direction === 'asc' ? valA - valB : valB - valA;
            }
        });
        
        // 6. 渲染表格行
        tbody.innerHTML = rows.map(r => { 
            const st = r.strategy || {}; 
            let targetDisplay = "";
            const isTotal = st.mode === 'total';
            const subjectLabel = isTotal ? "总分" : st.subject;

            if (st.targetType === 'rank') {
                targetDisplay = `${subjectLabel} 年排 <span style="color:#fd7e14; font-weight:bold;">${st.targetVal}</span> 名`;
            } else {
                const scoreVal = st.targetVal || st.targetScoreCalculated;
                targetDisplay = `${subjectLabel} <span style="color:#6f42c1; font-weight:bold;">${parseFloat(scoreVal).toFixed(1)}</span> 分`;
            }

            return `
                <tr>
                    <td>${r.className}</td>
                    <td onclick="showPlanDetail('${r.sid}', ${r.idx})" style="cursor:pointer; color:#007bff; font-weight:bold;" title="点击查看详情">
                        ${r.studentName} 📊
                    </td>
                    <td onclick="renamePlan('${r.sid}', ${r.idx})" style="cursor:pointer; color:#333;">
                        ${r.name || '未命名'} <span style="font-size:0.8em; color:#999;">✎</span>
                    </td>
                    <td>${isTotal ? '全科' : '单科'}</td>
                    <td>${targetDisplay}</td>
                    <td>
                        <button onclick="editPlanGlobal('${r.sid}', ${r.idx})" class="sidebar-button" style="background-color:#17a2b8; padding:4px 8px; font-size:0.8em;">修改</button>
                        <button onclick="reviewPlanGlobal('${r.sid}', ${r.idx})" class="sidebar-button" style="background-color:#28a745; padding:4px 8px; font-size:0.8em; margin-left:5px;">复盘</button>
                        <button onclick="deletePlanGlobal('${r.sid}', ${r.idx})" class="sidebar-button" style="background-color:#dc3545; padding:4px 8px; font-size:0.8em; margin-left:5px;">删除</button>
                    </td>
                </tr>
            `; 
        }).join('');
    }

    window.renamePlan = async (sid, idx) => { let archives = await localforage.getItem('G_Goal_Archives'); const newName = prompt("重命名:", archives[sid][idx].name); if (newName) { archives[sid][idx].name = newName; await localforage.setItem('G_Goal_Archives', archives); renderManageTable(); } };
    window.deletePlanGlobal = async (sid, idx) => { if (!confirm("确定删除?")) return; let archives = await localforage.getItem('G_Goal_Archives'); archives[sid].splice(idx, 1); await localforage.setItem('G_Goal_Archives', archives); renderManageTable(); };

    //    详情查看 (含来源显示 + 打印)
    window.showPlanDetail = async (sid, idx) => {
        let archives = await localforage.getItem('G_Goal_Archives');
        const plan = archives[sid][idx];
        if (!plan) return;

        let actualStudent = null;
        if (G_GoalOutcomeData) actualStudent = G_GoalOutcomeData.find(s => String(s.id) === String(sid));

        const modal = document.getElementById('goal-detail-modal');
        const titleEl = document.getElementById('goal-detail-title');
        const alertEl = document.getElementById('goal-detail-alert');
        const sourceInfoEl = document.getElementById('goal-detail-source-info');
        const kpiEl = document.getElementById('goal-detail-kpi');
        const tableEl = document.getElementById('goal-detail-table');
        const printBtn = document.getElementById('goal-detail-print-btn');

        titleEl.innerText = `${plan.studentName} - ${plan.name}`;

        //    来源显示逻辑
        const baseSource = plan.baselineSource || '系统默认/未知';
        const outSource = actualStudent ? currentOutcomeSourceName : null; // 使用 currentOutcomeSourceName

        sourceInfoEl.innerHTML = `
            <div style="background:#f1f3f5; padding:8px 12px; border-radius:6px; margin-bottom:15px; font-size:0.9em; color:#555; display:flex; flex-wrap:wrap; gap:15px;">
                <span>📄 <strong>规划基准:</strong> ${baseSource}</span>
                ${outSource ? `<span>📉 <strong>复盘依据:</strong> ${outSource}</span>` : ''}
            </div>
        `;

        if (actualStudent) {
            alertEl.style.display = 'none';
        } else {
            alertEl.innerHTML = `⚠️ 未检测到“达成成绩”数据源，当前仅显示规划内容。如需对比，请先在管理大厅顶部导入“达成成绩表”。`;
            alertEl.style.display = 'block';
        }

        const st = plan.strategy;
        const modeText = st.mode === 'total' ? "总分" : st.subject;
        let baseTotal = 0;
        st.details.forEach(d => baseTotal += d.current);

        let actualTotal = 0;
        let actualDiffHtml = '<span style="color:#ccc; font-size:0.5em;">(无数据)</span>';

        if (actualStudent) {
            if (st.mode === 'total') {
                actualTotal = actualStudent.totalScore;
            } else {
                actualTotal = actualStudent.scores[st.subject] || 0;
            }
            const diff = actualTotal - st.targetScoreCalculated;
            const diffClass = diff >= 0 ? 'progress' : 'regress';
            const diffIcon = diff >= 0 ? '🎉' : '⚠️';
            actualDiffHtml = `<span class="${diffClass}" style="font-size:0.6em;">${diffIcon} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}</span>`;
        }

        kpiEl.innerHTML = `
            <div class="kpi-card"><h3>基准${modeText}</h3><div class="value">${baseTotal.toFixed(1)}</div></div>
            <div class="kpi-card"><h3>目标${modeText}</h3><div class="value" style="color:var(--color-purple)">${st.targetScoreCalculated.toFixed(1)}</div></div>
            ${actualStudent ? `<div class="kpi-card" style="border-left:5px solid #fd7e14;"><h3>实际${modeText}</h3><div class="value" style="color:#fd7e14;">${actualTotal} ${actualDiffHtml}</div></div>` : ''}
            <div class="kpi-card"><h3>计划提升</h3><div class="value" style="color:#28a745">+${(st.targetScoreCalculated - baseTotal).toFixed(1)}</div></div>
        `;

        let tableHtml = `<table><thead><tr><th>科目</th><th>基准分</th><th>目标分</th><th>计划  量</th>${actualStudent ? `<th style="background:#fff8e1;">实际分</th><th style="background:#fff8e1;">达成差值</th>` : ''}<th>策略</th></tr></thead><tbody>`;
        st.details.forEach(d => {
            let actualCell = '';
            if (actualStudent) {
                const actScore = actualStudent.scores[d.subject] || 0;
                const diff = actScore - d.target;
                const color = diff >= 0 ? 'green' : 'red';
                const icon = diff >= 0 ? '✅' : '❌';
                actualCell = `<td style="font-weight:bold; background:#fffbf0;">${actScore}</td><td style="color:${color}; background:#fffbf0;">${icon} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}</td>`;
            }
            tableHtml += `<tr><td>${d.subject}</td><td>${d.current}</td><td><strong>${d.target.toFixed(1)}</strong></td><td style="color:#6f42c1;">+${d.gain.toFixed(1)}</td>${actualCell}<td>${d.difficultyText}</td></tr>`;
        });
        tableHtml += `</tbody></table>`;
        tableEl.innerHTML = tableHtml;

        // 打印绑定 (传递来源名)
        printBtn.onclick = () => {
            startDetailPrintJob(plan, actualStudent, baseTotal, actualTotal, baseSource, outSource);
        };

        modal.style.display = 'flex';
        setTimeout(() => {
            if (st.mode === 'total') {
                renderGoalWaterfall('goal-detail-waterfall-chart', baseTotal, st.targetScoreCalculated, st.details);
                renderGoalRadarComparison('goal-detail-radar-chart', st.details, actualStudent);
            } else {
                document.getElementById('goal-detail-waterfall-chart').innerHTML = '<p style="text-align:center; padding-top:50px; color:#999;">单科模式无瀑布图</p>';
                document.getElementById('goal-detail-radar-chart').innerHTML = '<p style="text-align:center; padding-top:50px; color:#999;">单科模式无雷达图</p>';
            }
        }, 100);
    };

    // [新增] 全局修改函数：回填数据并切换Tab
    window.editPlanGlobal = async (sid, idx) => {
        let archives = await localforage.getItem('G_Goal_Archives');
        const plan = archives[sid][idx];
        if (!plan) return;

        // 1. 标记进入编辑模式
        G_EditingPlanState = { sid: sid, idx: idx };
        
        // 2. 切换到“新建规划”Tab
        document.querySelector('button[data-tab="create"]').click();
        
        // 3. 选中学生 (这会初始化界面)
        selectStudent(sid); 

        // 4. 回填表单数据
        const st = plan.strategy;
        
        // 回填模式 (全科/单科) - 触发点击以联动显示隐藏
        const modeRadio = document.querySelector(`input[name="plan-mode"][value="${st.mode}"]`);
        if (modeRadio) modeRadio.click();

        // 回填科目 (如果是单科)
        if (st.mode === 'single') {
            const subSelect = document.getElementById('goal-single-subject-select');
            subSelect.value = st.subject;
            // 手动触发 change 更新下方基准分
            subSelect.dispatchEvent(new Event('change'));
        }

        // 回填目标类型 (分数/排名)
        const typeSelect = document.getElementById('goal-target-type');
        if (st.targetType) {
            typeSelect.value = st.targetType;
            typeSelect.dispatchEvent(new Event('change')); // 触发更新下方文字
        }

        // 回填目标值
        document.getElementById('goal-target-val').value = st.targetVal || "";

        // 5. 更新保存按钮的文字，提示用户正在修改
        const saveBtn = document.getElementById('goal-save-btn');
        saveBtn.innerHTML = "💾 确认修改 (覆盖旧记录)";
        saveBtn.style.backgroundColor = "#17a2b8"; // 变蓝色提示
        
        // 提示用户
        alert(`已加载【${plan.studentName}】的规划。\n请调整目标值后，点击“生成规划”，最后点击“确认修改”。`);
    };



    // [辅助] 3维雷达图渲染 (基准 vs 目标 vs 实际)
    function renderGoalRadarComparison(elemId, details, actualStudent) {
        const dom = document.getElementById(elemId);
        if (!dom) return;
        if (echartsInstances[elemId]) echartsInstances[elemId].dispose();
        const myChart = echarts.init(dom);

        const indicators = [];
        const dataBaseline = [];
        const dataTarget = [];
        const dataActual = [];

        details.forEach(d => {
            // 估算满分
            const full = d.current + d.room;
            indicators.push({ name: d.subject, max: full });
            dataBaseline.push(d.current);
            dataTarget.push(d.target);
            if (actualStudent) {
                dataActual.push(actualStudent.scores[d.subject] || 0);
            }
        });

        const seriesData = [
            { value: dataBaseline, name: '基准成绩', itemStyle: { color: '#6c757d' }, lineStyle: { type: 'dotted' } },
            { value: dataTarget, name: '规划目标', itemStyle: { color: '#6f42c1' }, areaStyle: { opacity: 0.1, color: '#6f42c1' } }
        ];

        if (actualStudent) {
            seriesData.push({
                value: dataActual,
                name: '实际成绩',
                itemStyle: { color: '#fd7e14' }, // 橙色
                lineStyle: { width: 3 },
                areaStyle: { opacity: 0.2, color: '#fd7e14' }
            });
        }

        const option = {
            tooltip: { trigger: 'item' },
            legend: { bottom: 0 },
            radar: { indicator: indicators, radius: '60%' },
            series: [{ type: 'radar', data: seriesData }]
        };
        myChart.setOption(option);
        echartsInstances[elemId] = myChart;
    }

    window.renamePlan = async (sid, idx) => {
        let archives = await localforage.getItem('G_Goal_Archives');
        const newName = prompt("重命名:", archives[sid][idx].name);
        if (newName) { archives[sid][idx].name = newName; await localforage.setItem('G_Goal_Archives', archives); renderManageTable(); }
    };
    window.deletePlanGlobal = async (sid, idx) => {
        if (!confirm("确定删除?")) return;
        let archives = await localforage.getItem('G_Goal_Archives');
        archives[sid].splice(idx, 1); await localforage.setItem('G_Goal_Archives', archives); renderManageTable();
    };

// [核心升级版] 复盘查看 (智能识别 排名/分数 目标)
    window.reviewPlanGlobal = async (sid, idx) => {
        if (!G_GoalOutcomeData) { alert("⚠️ 请先在顶部右侧导入【达成成绩表】，系统才能进行对比复盘！"); return; }

        let archives = await localforage.getItem('G_Goal_Archives');
        const plan = archives[sid][idx];
        const actualStudent = G_GoalOutcomeData.find(s => String(s.id) === String(sid));

        const panel = document.getElementById('goal-review-panel');
        const content = document.getElementById('goal-review-content');
        panel.style.display = 'block';

        if (!actualStudent) { 
            content.innerHTML = `<div style="padding:20px; text-align:center; color:#dc3545; background:#fff5f5; border-radius:8px;">❌ 错误：在“达成成绩表”中未找到该学生 (考号 ${sid})。<br>请检查是否导入了正确的考试数据。</div>`; 
            return; 
        }

        // ------------------------------------------------------
        // 1. 核心目标达成判定 (新增逻辑)
        // ------------------------------------------------------
        const st = plan.strategy;
        const isRankGoal = st.targetType === 'rank';
        const isTotal = st.mode === 'total';
        const subject = st.subject;

        // 获取目标值
        const targetVal = parseFloat(st.targetVal || st.targetScoreCalculated); 

        // 获取实际值
        let actualVal = 0;
        if (isRankGoal) {
            // 如果目标是排名，获取实际排名
            if (isTotal) {
                actualVal = actualStudent.gradeRank;
            } else {
                // 单科排名 (防御性检查)
                actualVal = (actualStudent.gradeRanks && actualStudent.gradeRanks[subject]) ? actualStudent.gradeRanks[subject] : 9999;
            }
        } else {
            // 如果目标是分数，获取实际分数
            if (isTotal) {
                actualVal = actualStudent.totalScore;
            } else {
                actualVal = actualStudent.scores[subject] || 0;
            }
        }

        // 计算差距 (分数是高好，排名是低好)
        let diff = 0;
        let isAchieved = false;
        let resultHtml = "";

        if (isRankGoal) {
            // 排名逻辑：目标 50，实际 40，diff = 50 - 40 = 10 (进步10名)
            diff = targetVal - actualVal; 
            isAchieved = actualVal <= targetVal;
            
            const color = isAchieved ? '#28a745' : '#dc3545';
            const icon = isAchieved ? '🎉 达成' : '⚠️ 未达成';
            const diffText = diff > 0 ? `前进 ${Math.abs(diff)} 名` : (diff < 0 ? `后退 ${Math.abs(diff)} 名` : `持平`);
            
            resultHtml = `
                <div class="kpi-card" style="background:#fff; border-left: 5px solid ${color}; width:100%; margin-bottom:20px;">
                    <h3>核心目标 (${isTotal ? '总分' : subject}年排)</h3>
                    <div style="display:flex; align-items:baseline; gap:15px;">
                        <span style="font-size:1.2em; color:#666;">目标: <strong>${targetVal}</strong></span>
                        <span style="font-size:1.2em; color:#333;">实际: <strong>${actualVal}</strong></span>
                        <span style="font-size:1.4em; font-weight:bold; color:${color}; margin-left:auto;">${icon} <span style="font-size:0.6em;">(${diffText})</span></span>
                    </div>
                </div>
            `;
        } else {
            // 分数逻辑：目标 600，实际 620，diff = 620 - 600 = 20 (进步20分)
            diff = actualVal - targetVal;
            isAchieved = actualVal >= targetVal;
            
            const color = isAchieved ? '#28a745' : '#dc3545';
            const icon = isAchieved ? '🎉 达成' : '⚠️ 未达成';
            const diffText = diff > 0 ? `超 ${Math.abs(diff).toFixed(1)} 分` : `差 ${Math.abs(diff).toFixed(1)} 分`;

            resultHtml = `
                <div class="kpi-card" style="background:#fff; border-left: 5px solid ${color}; width:100%; margin-bottom:20px;">
                    <h3>核心目标 (${isTotal ? '总分' : subject})</h3>
                    <div style="display:flex; align-items:baseline; gap:15px;">
                        <span style="font-size:1.2em; color:#666;">目标: <strong>${targetVal}</strong></span>
                        <span style="font-size:1.2em; color:#333;">实际: <strong>${actualVal}</strong></span>
                        <span style="font-size:1.4em; font-weight:bold; color:${color}; margin-left:auto;">${icon} <span style="font-size:0.6em;">(${diffText})</span></span>
                    </div>
                </div>
            `;
        }

        // ------------------------------------------------------
        // 2. 图表绘制逻辑 (保持分数达成率，作为努力程度参考)
        // ------------------------------------------------------
        const radios = document.getElementsByName('goal-trend-mode');
        const drawChart = () => {
            let mode = 'student';
            radios.forEach(r => { if (r.checked) mode = r.value; });
            const trendX = [];
            const trendY = [];

            // *注：趋势图依然使用【分数达成率】绘制，因为排名无法简单计算百分比 (排名1不是100%，排名500不是0%)
            // 这里我们比较的是 "计算出的目标分" vs "实际分"
            if (mode === 'student') {
                const studentPlans = archives[sid] || [];
                const sessionPlans = studentPlans.filter(p => p.sessionId === currentSessionId).sort((a, b) => a.id - b.id);
                sessionPlans.forEach(p => {
                    if (p.strategy.mode === 'total' && actualStudent) {
                        const rate = (actualStudent.totalScore / p.strategy.targetScoreCalculated) * 100;
                        trendX.push(p.name);
                        trendY.push(parseFloat(rate.toFixed(1)));
                    }
                });
                renderGoalTrendChart('goal-trend-line-chart', trendX, trendY, `得分达成率趋势 (当前学生: ${plan.studentName})`);
            } else {
                // ... 全列表平均逻辑 (保持原样) ...
                const allSessionPlans = [];
                Object.values(archives).forEach(userPlans => {
                    userPlans.forEach(p => { if (p.sessionId === currentSessionId) allSessionPlans.push(p); });
                });
                const groups = {};
                allSessionPlans.forEach(p => {
                    if (p.strategy.mode === 'total') {
                        if (!groups[p.name]) groups[p.name] = { sumRate: 0, count: 0, ts: p.id };
                        const sData = G_GoalOutcomeData.find(s => String(s.id) === String(p.studentId));
                        if (sData) {
                            const rate = (sData.totalScore / p.strategy.targetScoreCalculated) * 100;
                            groups[p.name].sumRate += rate;
                            groups[p.name].count++;
                        }
                    }
                });
                const sortedGroups = Object.keys(groups).map(name => ({
                    name: name, avgRate: groups[name].count > 0 ? (groups[name].sumRate / groups[name].count) : 0, ts: groups[name].ts
                })).sort((a, b) => a.ts - b.ts);
                sortedGroups.forEach(g => { trendX.push(g.name); trendY.push(parseFloat(g.avgRate.toFixed(1))); });
                renderGoalTrendChart('goal-trend-line-chart', trendX, trendY, `得分达成率趋势 (全列表平均)`);
            }
        };
        radios.forEach(r => r.onclick = drawChart);
        radios[0].checked = true;
        drawChart();

        // ------------------------------------------------------
        // 3. 渲染详情表格
        // ------------------------------------------------------
        let tableHtml = `<h4>${plan.studentName} - ${plan.name} (科目细分)</h4>`;
        tableHtml += `<table><thead><tr><th>科目</th><th>规划分数目标</th><th>实际得分</th><th>状态</th></tr></thead><tbody>`;
        
        st.details.forEach(d => {
            const actual = actualStudent.scores[d.subject] || 0;
            const diff = actual - d.target;
            // 科目细分依然对比分数（因为单科排名很难精确拆解）
            const status = diff >= 0 ? '✅' : `🔻 ${diff.toFixed(1)}`;
            const color = diff >= 0 ? 'green' : 'red';
            tableHtml += `<tr><td>${d.subject}</td><td>${d.target.toFixed(1)}</td><td style="font-weight:bold;">${actual}</td><td style="color:${color}">${status}</td></tr>`;
        });
        tableHtml += `</tbody></table>`;

        // 组合内容
        content.innerHTML = resultHtml + tableHtml;
        
        panel.scrollIntoView({ behavior: 'smooth' });
    };
}

// 辅助: 渲染趋势图
function renderGoalTrendChart(elemId, xData, yData, titleText) {
    const dom = document.getElementById(elemId);
    if (!dom) return;
    if (echartsInstances[elemId]) echartsInstances[elemId].dispose();
    const myChart = echarts.init(dom);
    const option = {
        title: { text: titleText, left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis', formatter: '{b}<br/>达成率: {c}%' },
        grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
        xAxis: { type: 'category', data: xData, axisLabel: { rotate: 30 } },
        yAxis: { type: 'value', name: '达成率 (%)', min: (val) => Math.floor(val.min * 0.9), max: (val) => Math.ceil(val.max * 1.05) },
        series: [{
            data: yData, type: 'line', smooth: true,
            markLine: { data: [{ yAxis: 100, name: '100% 目标线', lineStyle: { color: 'green', type: 'dashed' } }] },
            itemStyle: { color: '#6f42c1' },
            label: { show: true, position: 'top', formatter: '{c}%' }
        }]
    };
    myChart.setOption(option);
    echartsInstances[elemId] = myChart;
}

/* 辅助函数：智能分配算法 (保持不变，或直接引用之前的) */
function calculateSmartAllocation(student, targetTotal, allStudents, stats) {
    // ... (这里使用您之前已有的 calculateSmartAllocation 代码，无需更改) ...
    // 为了代码完整性，如果您没有保留之前的代码，请告诉我，我再贴一遍。
    // 简单起见，这里假设它已存在于 script.js 中。

    // 以下是简化的复用逻辑，确保代码能跑：
    const currentTotal = student.totalScore;
    const totalDeficit = targetTotal - currentTotal;
    const details = [];
    let totalWeight = 0;
    const items = [];

    G_DynamicSubjectList.forEach(subject => {
        const confFull = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].full : 100;
        const cur = student.scores[subject] || 0;
        const room = Math.max(0, confFull - cur);
        const weight = room; // 简化权重
        items.push({ subject, cur, room, weight });
        totalWeight += weight;
    });

    items.forEach(item => {
        let gain = 0;
        if (totalDeficit > 0 && totalWeight > 0) gain = (item.weight / totalWeight) * totalDeficit;
        if (gain > item.room) gain = item.room;

        details.push({
            subject: item.subject,
            current: item.cur,
            target: item.cur + gain,
            gain: gain,
            difficultyText: gain > 10 ? "重点突破" : "稳步提升"
        });
    });

    return { totalDeficit, details };
}

/**
 * [核心算法] 智能分配提分额度
 * 逻辑：
 * 1. 总缺口 = 目标分 - 当前分
 * 2. 计算每科的“提分潜力权重” (Weight):
 * - 因子 A (空间): 满分 (或年级最高分) - 学生当前分。 空间越大，权重越大。
 * - 因子 B (难度): 难度系数 (Average / Full)。 越简单(系数大)，通常越容易提分？
 * 或者反过来：标准差越大，说明越容易拉开分差。
 * 这里采用：权重 = (年级最高分 - 个人分) * (该科标准差 / 满分)
 * (解释：不仅要看还有多少分没拿，还要看这个科目大家的分数是否拉得很开。如果标准差大，说明努力一下容易变动)
 */
function calculateSmartAllocation(student, targetTotal, allStudents, stats) {
    const currentTotal = student.totalScore;
    const totalDeficit = targetTotal - currentTotal;

    const result = {
        details: [],
        totalDeficit: totalDeficit
    };

    if (totalDeficit <= 0) return result; // 已经达到目标

    let totalWeight = 0;
    const subjectWeights = [];

    G_DynamicSubjectList.forEach(subject => {
        const sStat = stats[subject];
        const currentScore = student.scores[subject] || 0;

        // 1. 确定该科目的“天花板” (使用年级最高分比较合理，或者满分)
        // 使用配置的满分更稳妥，或者取两者较小值防止异常数据
        const configFull = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].full : 100;
        const maxScore = sStat ? sStat.max : configFull;
        const ceiling = Math.min(configFull, maxScore);

        // 2. 计算提升空间 (Room to Grow)
        let room = ceiling - currentScore;
        if (room < 0) room = 0;

        // 3. 计算权重 (Heuristic)
        // 权重 = 空间 * (1 + 难度系数). 越简单的科目(难度系数高)，在有空间的情况下，越好拿分。
        // 或者：权重 = 空间 * 归一化的标准差。
        // 这里用简单模型：空间 * (该科平均分/满分)。 平均分高说明题目相对容易，补分容易。
        const difficulty = sStat ? (sStat.average / configFull) : 0.6;
        const weight = room * difficulty; // 简单粗暴但有效

        if (weight > 0) {
            subjectWeights.push({ subject, weight, room, currentScore, ceiling });
            totalWeight += weight;
        } else {
            subjectWeights.push({ subject, weight: 0, room, currentScore, ceiling });
        }
    });

    // 4. 分配分数
    subjectWeights.forEach(item => {
        let suggestedGain = 0;
        if (totalWeight > 0) {
            suggestedGain = (item.weight / totalWeight) * totalDeficit;
        }

        // 5. 修正边界：不能超过空间 (虽然权重逻辑已考虑，但按比例分配可能溢出)
        if (suggestedGain > item.room) suggestedGain = item.room;

        result.details.push({
            subject: item.subject,
            current: item.currentScore,
            target: item.currentScore + suggestedGain,
            gain: suggestedGain,
            room: item.room,
            difficultyText: getDifficultyText(item.room, item.currentScore, item.ceiling) // 获取评语
        });
    });

    return result;
}

// 辅助：生成简单的评语
function getDifficultyText(room, current, ceiling) {
    const ratio = current / ceiling;
    if (ratio > 0.90) return "保持优势 (冲满分)";
    if (ratio > 0.80) return "重点突破 (冲优秀)";
    if (ratio < 0.60) return "基础补强 (抓及格)";
    return "稳步提升";
}

/**
 * [渲染] 展示规划结果
 */
function renderGoalResults(student, targetRank, targetScore, strategy) {
    const container = document.getElementById('goal-result-container');
    container.style.display = 'block';

    const gap = strategy.totalDeficit;
    const gapClass = gap > 0 ? 'regress' : 'progress'; // gap>0 意味着还差分(红色)，gap<=0 意味着已达成(绿色)
    const gapText = gap > 0 ? `还需提升 ${gap.toFixed(1)} 分` : `已超越目标 ${Math.abs(gap).toFixed(1)} 分`;

    // 1. KPI
    document.getElementById('goal-kpi-cards').innerHTML = `
        <div class="kpi-card" style="border-left-color: #666;"><h3>当前总分 / 排名</h3><div class="value">${student.totalScore} <span style="font-size:0.5em">(${student.gradeRank}名)</span></div></div>
        <div class="kpi-card" style="border-left-color: var(--color-purple);"><h3>目标总分 / 排名</h3><div class="value">${targetScore.toFixed(1)} <span style="font-size:0.5em">(${targetRank}名)</span></div></div>
        <div class="kpi-card" style="border-left-color: ${gap > 0 ? '#dc3545' : '#28a745'};"><h3>差距分析</h3><div class="value" style="font-size:1.5em; color:${gap > 0 ? '#dc3545' : '#28a745'}">${gapText}</div></div>
    `;

    if (gap <= 0) {
        document.getElementById('goal-strategy-table').innerHTML = `<p style="padding:20px; text-align:center; color:#28a745; font-weight:bold;">🎉 恭喜！当前成绩已达成设定目标。</p>`;
        return;
    }

    // 2. 策略表
    // 按建议提分值降序排列 (优先展示重点拿分科目)
    const sortedDetails = [...strategy.details].sort((a, b) => b.gain - a.gain);

    document.getElementById('goal-strategy-table').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>科目</th>
                    <th>当前分数</th>
                    <th style="color:var(--color-purple);">建议提分 (+)</th>
                    <th>目标分数</th>
                    <th>提分难度/策略</th>
                    <th>提升空间余量</th>
                </tr>
            </thead>
            <tbody>
                ${sortedDetails.map(d => `
                    <tr>
                        <td><strong>${d.subject}</strong></td>
                        <td>${d.current}</td>
                        <td style="color:var(--color-purple); font-weight:bold; background-color:#f3e5f5;">+${d.gain.toFixed(1)}</td>
                        <td><strong>${d.target.toFixed(1)}</strong></td>
                        <td>${d.difficultyText}</td>
                        <td style="color:#999; font-size:0.9em;">${(d.room - d.gain).toFixed(1)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // 3. 瀑布图 (ECharts)
    renderGoalWaterfall('goal-waterfall-chart', student.totalScore, targetScore, sortedDetails);

    // 4. 雷达图 (ECharts)
    renderGoalRadar('goal-radar-chart', student, strategy.details);
}

/**
 * [图表] 提分路径瀑布图
 */
function renderGoalWaterfall(elementId, currentTotal, targetTotal, details) {
    const dom = document.getElementById(elementId);
    const myChart = echarts.init(dom);

    // 过滤掉提分为0的科目，避免图表太长
    const validDetails = details.filter(d => d.gain > 0.1);

    const xData = ['当前总分', ...validDetails.map(d => d.subject), '目标总分'];

    // 辅助数据构建
    // 瀑布图原理：透明柱子垫底
    let currentStack = currentTotal;
    const placeholders = [0]; // 第一根柱子起点0
    const values = [currentTotal]; // 第一根柱子高度

    validDetails.forEach(d => {
        placeholders.push(currentStack); // 垫高
        values.push(parseFloat(d.gain.toFixed(1))); //   量
        currentStack += d.gain;
    });

    // 最后一根柱子 (目标)
    placeholders.push(0);
    values.push(parseFloat(targetTotal.toFixed(1)));

    const option = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function (params) {
                let tar = params[1]; // 实际显示的柱子
                return `${tar.name}<br/>${tar.seriesName} : ${tar.value}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            splitLine: { show: false },
            data: xData
        },
        yAxis: {
            type: 'value',
            min: Math.floor(currentTotal * 0.9) // Y轴不从0开始，显示差异更明显
        },
        series: [
            {
                name: '辅助',
                type: 'bar',
                stack: '总量',
                itemStyle: {
                    barBorderColor: 'rgba(0,0,0,0)',
                    color: 'rgba(0,0,0,0)'
                },
                emphasis: {
                    itemStyle: {
                        barBorderColor: 'rgba(0,0,0,0)',
                        color: 'rgba(0,0,0,0)'
                    }
                },
                data: placeholders
            },
            {
                name: '分数',
                type: 'bar',
                stack: '总量',
                label: {
                    show: true,
                    position: 'top'
                },
                data: values.map((val, idx) => {
                    // 第一列和最后一列颜色不同
                    if (idx === 0) return { value: val, itemStyle: { color: '#6c757d' } };
                    if (idx === values.length - 1) return { value: val, itemStyle: { color: '#28a745' } };
                    return { value: val, itemStyle: { color: '#6f42c1' } }; //   量部分紫色
                })
            }
        ]
    };
    myChart.setOption(option);
    // 注册 resize
    echartsInstances[elementId] = myChart;
}

/**
 * [图表] 现状 vs 目标 雷达图
 */
function renderGoalRadar(elementId, student, details) {
    const dom = document.getElementById(elementId);
    const myChart = echarts.init(dom);

    const indicators = [];
    const currentData = [];
    const targetData = [];

    // 将 details 转为 map 方便查找
    const detailMap = {};
    details.forEach(d => detailMap[d.subject] = d);

    G_DynamicSubjectList.forEach(subject => {
        const config = G_SubjectConfigs[subject] || { full: 100 };
        indicators.push({ name: subject, max: config.full });

        currentData.push(student.scores[subject] || 0);

        const d = detailMap[subject];
        targetData.push(d ? parseFloat(d.target.toFixed(1)) : (student.scores[subject] || 0));
    });

    const option = {
        tooltip: {},
        legend: { data: ['当前成绩', '规划目标'], bottom: 0 },
        radar: {
            indicator: indicators,
            radius: '65%'
        },
        series: [{
            name: '当前 vs 目标',
            type: 'radar',
            data: [
                {
                    value: currentData,
                    name: '当前成绩',
                    itemStyle: { color: '#6c757d' },
                    areaStyle: { opacity: 0.2 }
                },
                {
                    value: targetData,
                    name: '规划目标',
                    itemStyle: { color: '#6f42c1' }, // 紫色代表目标
                    lineStyle: { type: 'dashed' },
                    areaStyle: { opacity: 0.1, color: '#6f42c1' }
                }
            ]
        }]
    };
    myChart.setOption(option);
    echartsInstances[elementId] = myChart;
}


/**
 *    打印目标规划书
 * 1. 修复文件名显示 (从 IndexedDB 读取)
 * 2. 修复 NaN 问题 (正确读取 totalDeficit)
 */
async function startGoalPrintJob(student, targetScore, targetRank, strategy) {
    // 1. [修复] 异步获取正确的文件名
    let examName = await localforage.getItem('G_MainFileName');
    if (!examName) examName = localStorage.getItem('G_MainFileName') || '本次考试';

    // 2. 排序策略数据
    const sortedDetails = [...strategy.details].sort((a, b) => b.gain - a.gain);

    // 3. [修复] 计算总缺口描述 (防止 NaN)
    // 如果 totalDeficit 未定义，则重  计算：目标 - 当前
    let gap = strategy.totalDeficit;
    if (gap === undefined || gap === null) {
        const currentTotal = (strategy.mode === 'single') ? (student.scores[strategy.subject] || 0) : student.totalScore;
        gap = targetScore - currentTotal;
    }

    const gapHtml = gap > 0.1 // 使用 0.1 容错
        ? `<span style="color:#dc3545; font-weight:bold;">还需提升 ${gap.toFixed(1)} 分</span>`
        : `<span style="color:#28a745; font-weight:bold;">当前已达成目标 (溢出 ${Math.abs(gap).toFixed(1)} 分)</span>`;

    // 4. 构建打印 HTML (保持原有样式)
    const printHtml = `
    <html>
    <head>
        <title>学业目标规划书 - ${student.name}</title>
        <style>
            body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; padding: 30px; color: #333; line-height: 1.5; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; letter-spacing: 2px; }
            .header p { margin: 5px 0 0; color: #666; font-size: 14px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #eee; }
            .info-item { display: flex; flex-direction: column; }
            .info-label { font-size: 12px; color: #666; margin-bottom: 4px; }
            .info-value { font-size: 18px; font-weight: bold; color: #333; }
            .highlight { color: #6f42c1; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th, td { border: 1px solid #999; padding: 10px; text-align: center; font-size: 14px; }
            th { background-color: #f0f0f0; font-weight: bold; color: #333; }
            tr:nth-child(even) { background-color: #fcfcfc; }
            .gain-cell { background-color: #f3e5f5; font-weight: bold; color: #6f42c1; font-size: 16px; }
            .footer-signatures { margin-top: 50px; display: flex; justify-content: space-between; page-break-inside: avoid; }
            .sign-box { width: 30%; border-top: 1px solid #333; padding-top: 10px; text-align: center; }
            .sign-label { display: block; margin-bottom: 40px; font-weight: bold; }
            .motto { text-align: center; font-style: italic; color: #666; margin-top: 40px; font-size: 14px; }
            @media print {
                @page { size: A4 portrait; margin: 1.5cm; }
                body { -webkit-print-color-adjust: exact; }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🎯 个人学业目标规划书</h1>
            <p>数据来源：${examName} | 生成时间：${new Date().toLocaleDateString()}</p>
        </div>

        <div class="info-grid">
            <div class="info-item">
                <span class="info-label">学生姓名 / 考号</span>
                <span class="info-value">${student.name} <span style="font-size:0.8em; font-weight:normal;">(${student.id})</span></span>
            </div>
            <div class="info-item">
                <span class="info-label">当前班级</span>
                <span class="info-value">${student.class}</span>
            </div>
            <div class="info-item">
                <span class="info-label">当前总分 / 年排</span>
                <span class="info-value">${student.totalScore} 分 / ${student.gradeRank} 名</span>
            </div>
            <div class="info-item">
                <span class="info-label">🎯 目标设定</span>
                <span class="info-value highlight">${targetScore.toFixed(0)} 分 / ${targetRank === '-' ? '-' : '前 ' + targetRank} 名</span>
            </div>
        </div>

        <div style="text-align: center; margin-bottom: 20px; font-size: 16px;">
            差距分析：${gapHtml}
        </div>

        <h3>📊 智能提分策略拆解</h3>
        <table>
            <thead>
                <tr>
                    <th>学科</th>
                    <th>当前分数</th>
                    <th>目标  量 (+)</th>
                    <th>目标分数</th>
                    <th>提分策略建议</th>
                    <th>剩余空间</th>
                </tr>
            </thead>
            <tbody>
                ${sortedDetails.map(d => `
                    <tr>
                        <td style="font-weight:bold;">${d.subject}</td>
                        <td>${d.current}</td>
                        <td class="gain-cell">+${d.gain.toFixed(1)}</td>
                        <td><strong>${d.target.toFixed(1)}</strong></td>
                        <td style="text-align:left; padding-left:15px;">${d.difficultyText}</td>
                        <td style="color:#888;">${(d.room - d.gain).toFixed(1)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <p style="font-size:13px; color:#666;">* <strong>计算逻辑：</strong>系统依据各科当前分数、年级满分空间及学科难度系数，自动将总目标分合理分配至各学科。</p>

        <div class="footer-signatures">
            <div class="sign-box"><span class="sign-label">学生承诺</span>(签字)</div>
            <div class="sign-box"><span class="sign-label">家长知情</span>(签字)</div>
            <div class="sign-box"><span class="sign-label">班主任/导师</span>(签字)</div>
        </div>

        <div class="motto">"目标不是为了预测未来，而是为了指导今天的行动。"</div>

    </body>
    </html>
    `;

    const win = window.open('', '_blank');
    win.document.write(printHtml);
    win.document.close();

    setTimeout(() => {
        win.focus();
        win.print();
    }, 500);
}


/**
 *    打印规划详情单 (含来源信息)
 */
function startDetailPrintJob(plan, actualStudent, baseTotal, actualTotal, baseName, outName) {
    const st = plan.strategy;
    const isCompare = !!actualStudent;

    // 1. 构建表格行
    const rows = st.details.map(d => {
        let compareCells = '';
        if (isCompare) {
            const act = actualStudent.scores[d.subject] || 0;
            const diff = act - d.target;
            const color = diff >= 0 ? 'green' : 'red';
            const icon = diff >= 0 ? '✅' : '❌';
            compareCells = `
                <td style="background-color:#fff8e1; font-weight:bold;">${act}</td>
                <td style="background-color:#fff8e1; color:${color};">${icon} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}</td>
            `;
        }

        return `
            <tr>
                <td>${d.subject}</td>
                <td>${d.current}</td>
                <td style="font-weight:bold;">${d.target.toFixed(1)}</td>
                <td>+${d.gain.toFixed(1)}</td>
                ${compareCells}
                <td style="text-align:left; padding-left:10px;">${d.difficultyText}</td>
            </tr>
        `;
    }).join('');

    // 2. 构建总结 HTML
    let summaryHtml = `
        <div class="info-box">
            <span>基准总分: <strong>${baseTotal.toFixed(1)}</strong></span>
            <span>目标总分: <strong style="color:#6f42c1;">${st.targetScoreCalculated.toFixed(1)}</strong></span>
            <span>计划提升: <strong>+${(st.targetScoreCalculated - baseTotal).toFixed(1)}</strong></span>
        </div>
    `;

    if (isCompare) {
        const diffTotal = actualTotal - st.targetScoreCalculated;
        const statusText = diffTotal >= 0 ? '🎉 达成目标' : '⚠️ 未达成';
        const statusColor = diffTotal >= 0 ? 'green' : 'red';
        summaryHtml += `
            <div class="info-box" style="border-color: #fd7e14; background-color: #fffbf0; margin-top:10px;">
                <span>实际总分: <strong style="font-size:1.2em; color:#fd7e14;">${actualTotal}</strong></span>
                <span style="color:${statusColor}; font-weight:bold;">${statusText} (${diffTotal > 0 ? '+' : ''}${diffTotal.toFixed(1)})</span>
            </div>
        `;
    }

    //    来源信息行
    const sourceHtml = `
        <div class="source-line">
            <span>📋 规划基准：${baseName}</span>
            ${outName ? ` | <span>📈 复盘依据：${outName}</span>` : ''}
        </div>
    `;

    // 3. 完整 HTML
    const html = `
    <html>
    <head>
        <title>规划详情 - ${plan.studentName}</title>
        <style>
            body { font-family: "Segoe UI", sans-serif; padding: 2cm; color: #333; }
            h2 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 5px; }
            .meta { text-align: center; color: #666; margin-bottom: 20px; font-size: 0.9em; }
            .source-line { text-align: center; font-size: 0.85em; color: #555; background: #eee; padding: 5px; border-radius: 4px; margin-bottom: 25px; }
            
            .info-box { 
                display: flex; justify-content: space-around; padding: 15px; 
                background: #f8f9fa; border: 1px solid #eee; border-radius: 8px; 
            }
            
            table { width: 100%; border-collapse: collapse; margin-top: 30px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: center; font-size: 0.95em; }
            th { background-color: #f0f0f0; }
            
            @media print {
                @page { size: A4 portrait; }
                body { -webkit-print-color-adjust: exact; }
            }
        </style>
    </head>
    <body>
        <h2>🎯 个人学业规划详情单</h2>
        <div class="meta">
            学生：<strong>${plan.studentName}</strong> | 
            规划名称：${plan.name} | 
            创建时间：${plan.createDate}
        </div>

        ${sourceHtml}

        ${summaryHtml}

        <h3>📚 科目详情分解</h3>
        <table>
            <thead>
                <tr>
                    <th>科目</th><th>基准分</th><th>目标分</th><th>计划  量</th>
                    ${isCompare ? '<th>实际分</th><th>达成差值</th>' : ''}
                    <th>策略建议</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        
        <div style="margin-top: 40px; text-align: center; color: #999; font-size: 0.8em;">
            * 报表生成时间：${new Date().toLocaleString()}
        </div>
    </body>
    </html>
    `;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 500);
}

/**
 *    13.20 绘制知识点归因图谱
 */
function drawItemKnowledgeGraph() {
    const chartDom = document.getElementById('item-chart-knowledge-graph');
    if (!chartDom) return;

    if (echartsInstances['item-chart-knowledge-graph']) {
        echartsInstances['item-chart-knowledge-graph'].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances['item-chart-knowledge-graph'] = myChart;

    // 1. 获取配置与数据
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;

    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) return;
    const subjectConfig = G_ItemAnalysisConfig[subjectName] || {};
    const graphDef = subjectConfig['_knowledge_graph_def_'];

    // 2. 解析用户定义的依赖关系
    const edges = [];
    const nodesSet = new Set();

    if (graphDef) {
        const lines = graphDef.split('\n');
        lines.forEach(line => {
            if (line.includes('->')) {
                // 1. 按箭头分割并去除空白
                const parts = line.split('->').map(s => s.trim()).filter(s => s);

                // 2. 循环创建链式关系 (A->B, B->C, C->D...)
                for (let i = 0; i < parts.length - 1; i++) {
                    const source = parts[i];
                    const target = parts[i + 1];

                    // 防止重复添加相同的边（可选优化）
                    // 但 ECharts Graph 允许重边，这里为了简单直接推入即可
                    edges.push({ source, target });
                    nodesSet.add(source);
                    nodesSet.add(target);
                }
            }
        });
    }

    // 3. 计算当前筛选群体的知识点得分率
    // (复用现有逻辑，但针对特定群体)
    const allStudents = G_ItemAnalysisData[subjectName].students;
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 计算得分率 Map: { "二次函数": 0.65, ... }
    const kpRates = {};

    // 获取所有涉及的知识点（包括配置中未定义但在题目中出现的）
    const recalculatedStats = getRecalculatedItemStats(subjectName);
    // 遍历所有题目累加分数
    const aggregates = {};

    const processQ = (qList, scoreType, statsType) => {
        qList.forEach(qName => {
            const content = subjectConfig[qName]?.content || "";
            const kps = content.split(/[;；]/).map(k => k.trim()).filter(k => k);
            const stat = recalculatedStats[statsType][qName];
            const full = stat?.manualFullScore || stat?.maxScore || 0;

            if (full > 0 && kps.length > 0) {
                let totalGot = 0;
                let count = 0;
                filteredStudents.forEach(s => {
                    const v = s[scoreType][qName];
                    if (typeof v === 'number') { totalGot += v; count++; }
                });
                const avgScore = count > 0 ? totalGot / count : 0;

                kps.forEach(kp => {
                    if (!aggregates[kp]) aggregates[kp] = { got: 0, full: 0 };
                    aggregates[kp].got += avgScore;
                    aggregates[kp].full += full;
                    nodesSet.add(kp); // 确保图谱包含所有出现的知识点
                });
            }
        });
    };

    processQ(G_ItemAnalysisData[subjectName].minorQuestions, 'minorScores', 'minorStats');
    processQ(G_ItemAnalysisData[subjectName].majorQuestions, 'majorScores', 'majorStats');

    // 生成最终得分率
    Object.keys(aggregates).forEach(kp => {
        const agg = aggregates[kp];
        kpRates[kp] = agg.full > 0 ? (agg.got / agg.full) : 0;
    });

    if (nodesSet.size === 0) {
        chartDom.innerHTML = `<p style="text-align:center; padding-top:100px; color:#999;">暂无知识点数据，请在“配置题目”中填写考察内容和层级关系。</p>`;
        return;
    }

    // 4. 构建 ECharts Nodes
    const echartsNodes = Array.from(nodesSet).map(kp => {
        const rate = kpRates[kp] !== undefined ? kpRates[kp] : 0; // 默认0或者不显示

        // 颜色逻辑
        let color = '#007bff'; // 默认蓝
        if (rate >= 0.85) color = '#28a745'; // 优 (绿)
        else if (rate < 0.6) color = '#dc3545'; // 差 (红)
        else color = '#ffc107'; // 中 (黄)

        return {
            name: kp,
            value: (rate * 100).toFixed(1), // 显示为百分比
            itemStyle: { color: color },
            label: { show: true, color: '#333', position: 'right' },
            symbolSize: 20 + (rate * 10) // 分数越高点越大? 或者反过来，薄弱点大? 这里随分数变大
        };
    });

    // 5. 构建 ECharts Links (归因链逻辑)
    const echartsLinks = edges.map(edge => {
        const sourceRate = kpRates[edge.source] || 1;
        const targetRate = kpRates[edge.target] || 1;

        // 归因逻辑：如果父子双双挂科 (<0.6)，则为“核心归因链”
        const isCritical = (sourceRate < 0.6 && targetRate < 0.6);

        return {
            source: edge.source,
            target: edge.target,
            lineStyle: {
                color: isCritical ? '#dc3545' : '#ccc', // 红色或灰色
                width: isCritical ? 4 : 1,              // 加粗
                type: isCritical ? 'solid' : 'solid',
                curveness: 0.2
            },
            symbol: ['none', 'arrow']
        };
    });

    // 6. 渲染图表
    const option = {
        title: { text: '知识点关联图谱', left: 'center' },
        tooltip: {
            formatter: (params) => {
                if (params.dataType === 'node') {
                    return `<strong>${params.name}</strong><br/>得分率: ${params.value}%`;
                }
                if (params.dataType === 'edge') {
                    return `${params.data.source} -> ${params.data.target}`;
                }
            }
        },
        series: [{
            type: 'graph',
            layout: 'force', // 力引导布局
            data: echartsNodes,
            links: echartsLinks,
            roam: true,
            label: { show: true, position: 'bottom' },
            force: {
                repulsion: 500,
                edgeLength: 100
            },
            lineStyle: {
                opacity: 0.9,
                width: 2,
                curveness: 0
            }
        }]
    };

    myChart.setOption(option);
}


/**
 * [升级版] 15. 渲染模块十五：考场编排
 *     功能：支持“竖向填充”模式 (竖向Z型 / 竖向S型)
 */
function renderExamArrangement(container) {
    const studentsSource = G_StudentsData;
    const studentCount = studentsSource.length;

    container.innerHTML = `
        <h2>🧘 模块十五：考场座位编排 & 考号生成</h2>
        
        <div class="main-card-wrapper" style="border-left: 5px solid var(--color-cyan); margin-bottom: 20px; padding-bottom: 30px;">
            <h4 style="margin-top:0; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">🛠️ 编排配置参数</h4>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 25px; align-items: end;">
                
                <div>
                    <label style="display:block; margin-bottom:8px; font-weight:600; color:#333;">1. 考生排序策略:</label>
                    <select id="exam-sort-strategy" class="sidebar-select" style="font-weight:bold; color:var(--primary-color); width:100%; padding: 10px;">
                        <option value="random">🎲 完全随机打乱</option>
                        <option value="class_balanced">⚖️ 班级均衡 (分层穿插)</option>
                        <option value="score_desc">🏆 按总分高到低 (优生在前)</option>
                        <option value="score_asc">📉 按总分低到高 (优生在后)</option>
                        
                    </select>
                </div>

                <div>
                    <label style="display:block; margin-bottom:8px; font-weight:600; color:#333;">2. 单场人数 (Capacity):</label>
                    <input type="number" id="exam-room-capacity" class="sidebar-select" value="40" min="1" style="width:100%; padding: 10px;">
                </div>

                <div>
                    <label style="display:block; margin-bottom:8px; font-weight:600; color:#333;">3. 座位列数 (Columns):</label>
                    <input type="number" id="exam-room-columns" class="sidebar-select" value="5" min="1" style="width:100%; padding: 10px;">
                </div>

                <div>
                    <label style="display:block; margin-bottom:8px; font-weight:600; color:#333;">4. 座位填充模式:</label>
                    <select id="exam-seat-pattern" class="sidebar-select" style="width:100%; padding: 10px; border: 2px solid var(--color-orange);">
                        <optgroup label="横向填充 (先左右，再换行)">
                            <option value="z_shape">➡️ 横向 Z 型 (从左到右)</option>
                            <option value="s_shape">🐍 横向 S 型 (蛇形/弓字形)</option>
                        </optgroup>
                        <optgroup label="竖向填充 (先前后，再换列)">
                            <option value="z_shape_v">⬇️ 竖向 Z 型 (从前到后)</option>
                            <option value="s_shape_v">🧬 竖向 S 型 (第1列后, 第2列前...)</option>
                        </optgroup>
                    </select>
                </div>

                <div>
                    <label style="display:block; margin-bottom:8px; font-weight:600; color:#333;">5. 考号生成:</label>
                    <select id="exam-id-mode" class="sidebar-select" style="width:100%; padding: 10px;">
                        <option value="use_existing">保持现有 (Excel原数据)</option>
                        <option value="auto_generate">自动生成 (考场+座位)</option>
                    </select>
                </div>
                
                <div>
                    <label style="display:block; margin-bottom:8px; font-weight:600; color:#666;">前缀 (可选):</label>
                    <input type="text" id="exam-id-prefix" class="sidebar-select" placeholder="例: 2025H1" style="width:100%; padding: 10px;">
                </div>

            </div>
            
            <div style="margin-top: 30px; text-align: right; border-top: 1px solid #eee; padding-top: 20px;">
                <span style="color: #666; margin-right: 20px; font-size: 1.1em;">待编排学生总数: <strong style="color: var(--primary-color); font-size: 1.2em;">${studentCount}</strong> 人</span>
                <button id="exam-generate-btn" class="sidebar-button" style="background-color: var(--color-cyan); padding: 10px 25px; font-size: 1em;">⚙️ 开始编排 & 预览</button>
            </div>
        </div>

        <div id="exam-result-area" style="display: none;">
            <div class="main-card-wrapper">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0;">📋 编排结果预览</h3>
                    <button id="exam-export-btn" class="sidebar-button" style="background-color: var(--color-green);">📥 导出座位表 (Excel)</button>
                </div>
                
                <div id="exam-room-tabs" style="display:flex; gap:5px; overflow-x:auto; padding-bottom:10px; margin-bottom:10px; border-bottom:1px solid #eee;"></div>
                <div id="exam-room-preview" style="min-height: 300px;"></div>
            </div>
        </div>
    `;

    let generatedRooms = [];

    const generateBtn = document.getElementById('exam-generate-btn');
    const exportBtn = document.getElementById('exam-export-btn');

    generateBtn.addEventListener('click', () => {
        // 实时读取所有配置
        const config = {
            sort: document.getElementById('exam-sort-strategy').value,
            capacity: parseInt(document.getElementById('exam-room-capacity').value) || 30,
            cols: parseInt(document.getElementById('exam-room-columns').value) || 8,
            pattern: document.getElementById('exam-seat-pattern').value,
            idMode: document.getElementById('exam-id-mode').value,
            idPrefix: document.getElementById('exam-id-prefix').value.trim()
        };

        console.log("开始编排，配置:", config);

        generatedRooms = calculateExamArrangement(studentsSource, config);
        renderExamPreview(generatedRooms, config.cols);
    });

    exportBtn.addEventListener('click', () => {
        if (generatedRooms.length > 0) exportExamToExcel(generatedRooms);
        else alert("请先生成编排方案！");
    });
}

/**
 * [核心算法] 计算考场编排 (支持横向/竖向填充)
 */
function calculateExamArrangement(students, config) {
    let sortedStudents = [];

    // --- 1. 排序策略 ---
    if (config.sort === 'class_balanced') {
        const classMap = {};
        students.forEach(s => {
            if (!classMap[s.class]) classMap[s.class] = [];
            classMap[s.class].push(s);
        });
        const queues = [];
        Object.keys(classMap).sort().forEach(cls => {
            classMap[cls].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
            queues.push(classMap[cls]);
        });
        let hasStudent = true;
        let i = 0;
        while (hasStudent) {
            hasStudent = false;
            for (let q of queues) {
                if (i < q.length) {
                    sortedStudents.push(q[i]);
                    hasStudent = true;
                }
            }
            i++;
        }
    } else if (config.sort === 'score_desc') {
        sortedStudents = [...students].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    } else if (config.sort === 'score_asc') {
        sortedStudents = [...students].sort((a, b) => (a.totalScore || 0) - (b.totalScore || 0));
    } else {
        sortedStudents = [...students].sort(() => Math.random() - 0.5);
    }

    // --- 2. 考场切分 ---
    const rooms = [];
    const totalStudents = sortedStudents.length;
    let currentStudentIdx = 0;
    let roomNum = 1;

    // 计算每个考场最大需要多少行 (用于竖向填充)
    // 竖向填充时，我们需要知道这一列填到第几行就该换列了
    const maxRowsPerRoom = Math.ceil(config.capacity / config.cols);

    while (currentStudentIdx < totalStudents) {
        const endIdx = Math.min(currentStudentIdx + config.capacity, totalStudents);
        let roomStudents = sortedStudents.slice(currentStudentIdx, endIdx);

        if (config.sort !== 'random') {
            // roomStudents.sort(() => Math.random() - 0.5); // 可选：组内再次随机
        }

        // --- 3. 坐标计算 & 考号生成 ---
        const processedStudents = roomStudents.map((student, indexInRoom) => {
            const seatNo = indexInRoom + 1;

            // 生成考号
            let examId = student.id;
            if (config.idMode === 'auto_generate') {
                const rStr = String(roomNum).padStart(2, '0');
                const sStr = String(seatNo).padStart(2, '0');
                const prefix = config.idPrefix || "";
                examId = `${prefix}${rStr}${sStr}`;
            }

            let row = 0;
            let col = 0;

            // [关键修改] 根据模式计算坐标 (Row, Col)
            // indexInRoom: 0, 1, 2, ...

            switch (config.pattern) {
                case 's_shape': // 横向S型 (蛇形)
                    row = Math.floor(indexInRoom / config.cols);
                    col = indexInRoom % config.cols;
                    // 偶数行(0,2,4)：左->右；奇数行(1,3,5)：右->左 (即翻转列号)
                    if (row % 2 !== 0) {
                        col = config.cols - 1 - col;
                    }
                    break;

                case 'z_shape_v': // 竖向Z型 (从前到后，填满一列换下列)
                    // 先确定在第几列
                    col = Math.floor(indexInRoom / maxRowsPerRoom);
                    // 再确定在第几行
                    row = indexInRoom % maxRowsPerRoom;
                    break;

                case 's_shape_v': // 竖向S型 (第1列前->后，第2列后->前)
                    col = Math.floor(indexInRoom / maxRowsPerRoom);
                    let remainder = indexInRoom % maxRowsPerRoom;

                    // 偶数列(0,2,4)：上->下 (row = remainder)
                    // 奇数列(1,3,5)：下->上 (row = max - 1 - remainder)
                    if (col % 2 === 0) {
                        row = remainder;
                    } else {
                        row = maxRowsPerRoom - 1 - remainder;
                    }
                    break;

                case 'z_shape': // 横向Z型 (默认)
                default:
                    row = Math.floor(indexInRoom / config.cols);
                    col = indexInRoom % config.cols;
                    break;
            }

            return {
                ...student,
                tempExamId: examId,
                roomNum: roomNum,
                seatNo: seatNo,
                gridRow: row,
                gridCol: col
            };
        });

        rooms.push({
            id: roomNum,
            name: `第 ${roomNum} 考场`,
            students: processedStudents
        });

        currentStudentIdx += config.capacity;
        roomNum++;
    }

    return rooms;
}

/**
 * [渲染] 考场预览 (逻辑优化)
 */
function renderExamPreview(rooms, cols) {
    const resultArea = document.getElementById('exam-result-area');
    const tabContainer = document.getElementById('exam-room-tabs');
    const previewContainer = document.getElementById('exam-room-preview');

    if (resultArea) resultArea.style.display = 'block';

    // 生成 Tabs
    tabContainer.innerHTML = rooms.map((r, idx) => `
        <button class="sidebar-button room-tab-btn ${idx === 0 ? 'active-tab' : ''}" 
            data-idx="${idx}"
            style="background-color: ${idx === 0 ? 'var(--primary-color)' : '#fff'}; color: ${idx === 0 ? '#fff' : '#333'}; border: 1px solid #ccc; white-space: nowrap;">
            ${r.name} (${r.students.length}人)
        </button>
    `).join('');

    // 绑定 Tab 点击事件 (避免使用全局函数 window.switchExamRoom)
    const tabs = tabContainer.querySelectorAll('.room-tab-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            // 更  样式
            tabs.forEach(t => {
                t.style.backgroundColor = '#fff';
                t.style.color = '#333';
            });
            btn.style.backgroundColor = 'var(--primary-color)';
            btn.style.color = '#fff';

            // 渲染
            renderRoomGrid(rooms[idx], cols, previewContainer);
        });
    });

    // 默认显示第1个
    if (rooms.length > 0) {
        renderRoomGrid(rooms[0], cols, previewContainer);
    }
}

/**
 * [渲染] 单个考场网格
 * 重要说明：
 * - HTML Grid 默认从左到右渲染。
 * - 如果要让“第一列”在屏幕右侧 (黑板视角)，我们需要把 col=0 放在最右边。
 * - 做法：渲染循环从 cols-1 (左) 遍历到 0 (右)。
 */
function renderRoomGrid(room, cols, container) {
    if (!room || !room.students) return;

    // 计算最大行数
    const maxRow = Math.max(...room.students.map(s => s.gridRow)) + 1;

    let html = `<div style="display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 10px; max-width: 1000px; margin: 0 auto;">`;

    // 构建矩阵
    const gridMap = Array(maxRow).fill(null).map(() => Array(cols).fill(null));
    room.students.forEach(s => {
        if (s.gridRow < maxRow && s.gridCol < cols) {
            gridMap[s.gridRow][s.gridCol] = s;
        }
    });

    // 渲染循环
    for (let r = 0; r < maxRow; r++) {
        // 从最左边(列号最大) 渲染到 最右边(列号最小)
        for (let c = cols - 1; c >= 0; c--) {
            const student = gridMap[r][c];
            if (student) {
                html += `
                    <div style="border: 1px solid #ddd; padding: 10px; border-radius: 6px; background: #f9f9f9; text-align: center; font-size: 0.85em; min-height: 60px; display: flex; flex-direction: column; justify-content: center;">
                        <div style="font-weight: bold; color: var(--primary-color); margin-bottom: 4px;">${student.name}</div>
                        <div style="color: #666;">座:${student.seatNo}</div>
                        <div style="color: #999; font-size: 0.8em;">${student.tempExamId || ''}</div>
                    </div>
                `;
            } else {
                html += `<div style="border: 1px dashed #eee; border-radius: 6px; background-color: #fff;"></div>`;
            }
        }
    }
    html += `</div>`;

    container.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px; background: #eee; padding: 5px; border-radius: 4px; font-weight: bold; color: #555;">
            📺 讲台 / 黑板 (视图：最右侧为第一列)
        </div>
        ${html}
    `;
}

/**
 * [旗舰版 V4] 导出 Excel (布局修正：从右往左填充，符合黑板视角)
 */
function exportExamToExcel(rooms) {
    if (!rooms || rooms.length === 0) {
        alert("暂无考场数据");
        return;
    }

    const wb = XLSX.utils.book_new();

    // ==========================================
    // Sheet 1: 考场总名单 (保持不变)
    // ==========================================
    const allData = [];
    rooms.forEach(r => {
        r.students.forEach(s => {
            allData.push({
                "考场": r.name,
                "座位号": s.seatNo,
                "准考证号": s.tempExamId,
                "姓名": s.name,
                "班级": s.class,
                "总分": s.totalScore || 0
            });
        });
    });
    const wsList = XLSX.utils.json_to_sheet(allData);
    wsList['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsList, "考场总名单");

    // ==========================================
    // Sheet 2: 考场座位布局图 (方向修正版)
    // ==========================================
    const layoutData = [];

    rooms.forEach(r => {
        // 1. 考场标题
        layoutData.push([`=== ${r.name} (共${r.students.length}人) ===`]);

        // 2. 计算该考场的最大行列
        let maxRow = 0;
        let maxCol = 0;
        if (r.students.length > 0) {
            maxRow = Math.max(...r.students.map(s => s.gridRow));
            maxCol = Math.max(...r.students.map(s => s.gridCol));
        }

        // 3. 构建“组别”行 (从左到右：第N组 ... 第1组)
        // 这样 Excel 左边是最后一组，右边是第一组
        const groupRow = [];
        const totalGroups = maxCol + 1;
        for (let i = 0; i < totalGroups; i++) {
            const groupNum = totalGroups - i; // 倒序：5, 4, 3, 2, 1
            groupRow.push(`第${groupNum}组`, ""); // 占两列(班级+姓名)
        }
        groupRow.push(""); // 门的那一列留空
        layoutData.push(groupRow);

        // 4. 构建表头行 (班级 | 姓名 ... | 前门)
        const headerRow = [];
        for (let c = 0; c <= maxCol; c++) {
            headerRow.push("班级", "姓名");
        }
        headerRow.push("前门"); // 最右侧添加前门
        layoutData.push(headerRow);

        // 5. 初始化网格
        // 行数 = maxRow + 1
        // 列数 = (maxCol + 1) * 2 + 1 (门列)
        const grid = [];
        for (let i = 0; i <= maxRow; i++) {
            const rowArr = new Array((maxCol + 1) * 2 + 1).fill("");
            grid.push(rowArr);
        }

        // 6. 填充学生数据 (核心修正：列序翻转)
        r.students.forEach(s => {
            // [核心修改] 从右向左填充
            // s.gridCol = 0 (第1组) -> 映射到最右边的 Excel 列
            // s.gridCol = max (第N组) -> 映射到最左边的 Excel 列
            // 算法：(maxCol - s.gridCol) * 2

            const colIndex = (maxCol - s.gridCol) * 2;
            const rowIndex = s.gridRow;

            if (grid[rowIndex] && grid[rowIndex][colIndex] !== undefined) {
                // 班级名简化
                let classStr = s.class.replace(/[^0-9]/g, '');
                if (!classStr) classStr = s.class;

                grid[rowIndex][colIndex] = classStr;     // 左格：班级
                grid[rowIndex][colIndex + 1] = s.name;   // 右格：姓名
            }
        });

        // 7. 添加“后门” (右下角)
        if (grid.length > 0) {
            const lastRowIndex = grid.length - 1;
            const lastColIndex = grid[0].length - 1;
            grid[lastRowIndex][lastColIndex] = "后门";
        }

        // 8. 写入数据
        layoutData.push(...grid);
        layoutData.push([]); // 空行分隔
        layoutData.push([]);
    });

    const wsLayout = XLSX.utils.aoa_to_sheet(layoutData);

    // 9. 设置列宽
    const colWidths = [];
    for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) colWidths.push({ wch: 6 });  // 班级列窄
        else colWidths.push({ wch: 12 });             // 姓名列宽
    }
    colWidths.push({ wch: 8 }); // 门列
    wsLayout['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, wsLayout, "考场座位布局");
    XLSX.writeFile(wb, `考场编排表${new Date().toLocaleDateString()}.xlsx`);
}


// =====================================================================
//    UPGRADED V2    模块十六：智能互助分组生成器 (基于 T 分互补)
// =====================================================================

/**
 * 16.1 [AI 旗舰版] 渲染主界面 (AI 排座 + 学习分组)
 */
function renderStudyGroups(container) {
    const classes = [...new Set(G_StudentsData.map(s => s.class))].sort();
    const subjectOptions = G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('');

    container.innerHTML = `
        <h2>🧩 模块十六：智能互助分组 & AI 座位编排</h2>
        
        <div style="margin-bottom: 20px; border-bottom: 2px solid #eee; display: flex; gap: 20px;">
            <button class="tab-btn active" onclick="switchGroupTab('study')" id="tab-btn-study" 
                style="padding: 10px 20px; font-weight: bold; cursor: pointer; border:none; background:none; border-bottom: 3px solid #6f42c1; color: #6f42c1;">
                📚 学习互助分组
            </button>
            <button class="tab-btn" onclick="switchGroupTab('seat')" id="tab-btn-seat" 
                style="padding: 10px 20px; font-weight: bold; cursor: pointer; border:none; background:none; color: #666; border-bottom: 3px solid transparent;">
                🤖 AI 班级座位编排
            </button>
        </div>

        <div id="tab-content-study">
            ${getTab1HTML(classes, subjectOptions)} 
        </div>

        <div id="tab-content-seat" style="display:none;">
            <div class="main-card-wrapper" style="border-left: 5px solid #20c997;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">
                    <h4 style="margin:0;">🤖 AI 座位设计师</h4>
                    <span id="seat-db-status" style="font-size:0.85em; color:#666;">未检测到身高数据</span>
                </div>
                
                <div style="background:#f0fdf4; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid #bbf7d0;">
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <label style="font-weight:bold;">目标班级:</label>
                        <select id="seat-class-select" class="sidebar-select" style="width:auto; font-weight:bold; min-width:150px;">
                                ${classes.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>

                        <label for="seat-physical-upload" class="sidebar-button" style="background-color:#fff; color:#333; border:1px solid #ccc; cursor:pointer; padding: 6px 12px;">
                            📤 导入身高/性别表
                        </label>
                        <input type="file" id="seat-physical-upload" style="display:none;" accept=".xlsx, .xls, .csv">

                        <button id="btn-save-physical" class="sidebar-button" style="background-color:#20c997; display:none; padding: 6px 12px;">💾 保存库</button>
                        
                        <button id="btn-clear-physical" class="sidebar-button" style="background-color:#dc3545; display:none; padding: 6px 12px;">🗑️ 删除库</button>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px; align-items: start;">
                    <div>
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">教室列布局 (从左到右)</label>
                        <input type="text" id="seat-columns-config" class="sidebar-select" value="2,2,2,1" style="width:100%; letter-spacing:5px;">
                        <p style="font-size:0.8em; color:#666; margin-top:5px;">例 "2,2,2,2" 表示4组双人座。</p>
                        
                        <div style="margin-top:15px;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">模型选择</label>
                            <select id="seat-ai-model" class="sidebar-select" style="width:100%;">
                                <option value="deepseek-chat">🚀 DeepSeek V3 (极速)</option>
                                <option value="deepseek-reasoner">🧠 DeepSeek R1 (深度思考)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">✨ AI 排座指令 (Prompt)</label>
                        <textarea id="seat-ai-prompt" class="sidebar-select" rows="4" style="width:100%; font-family:sans-serif; line-height:1.4;" 
                            placeholder="请输入您的排座要求，例如：&#10;1. 必须严格按照身高从矮到高排列，矮的在前，高的在后。&#10;2. 同桌尽量男女搭配。&#10;3. 同一个学习小组的成员尽量安排在相邻区域。"></textarea>
                    </div>
                </div>
                
                <div style="margin-top:20px; text-align:right; border-top:1px solid #eee; padding-top:15px; display:flex; justify-content:flex-end; gap:10px;">
                    <button id="btn-stop-ai-seat" class="sidebar-button" style="background-color: #dc3545; padding: 10px 20px; font-size: 1em; display:none;">
                        ⏹ 停止生成
                    </button>
                    
                    <button id="btn-generate-ai-seats" class="sidebar-button" style="background-color: #6f42c1; padding: 10px 30px; font-size: 1.1em;">
                        🪄 开始 AI 排座
                    </button>
                </div>
                
                <div id="seat-ai-loading" style="display:none; margin-top: 20px;">
                    <div style="text-align:center; margin-bottom: 10px; color:#6f42c1;">
                        <span style="font-size:1.5em; vertical-align:middle;">🤖</span>
                        <span id="seat-ai-status-text" style="font-weight:bold; vertical-align:middle;">AI 正在思考中...</span>
                    </div>
                    
                    <div style="background: #1e1e1e; color: #d4d4d4; border-radius: 6px; padding: 0; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; height: 300px; display: flex; flex-direction: column; box-shadow: 0 4px 12px rgba(0,0,0,0.2); border: 1px solid #333;">
                        <div style="background: #2d2d2d; padding: 5px 10px; border-bottom: 1px solid #333; border-radius: 6px 6px 0 0; display: flex; gap: 6px; align-items: center;">
                            <span style="width:10px; height:10px; border-radius:50%; background:#ff5f56;"></span>
                            <span style="width:10px; height:10px; border-radius:50%; background:#ffbd2e;"></span>
                            <span style="width:10px; height:10px; border-radius:50%; background:#27c93f;"></span>
                            <span style="margin-left: 10px; color: #888;">DeepSeek Output Stream</span>
                        </div>
                        
                        <div id="seat-ai-log-container" style="flex: 1; overflow-y: auto; padding: 10px; white-space: pre-wrap; word-break: break-all;">
                            <div id="seat-ai-reasoning" style="color: #808080; border-left: 2px solid #444; padding-left: 8px; margin-bottom: 10px; display:none;"></div>
                            <div id="seat-ai-content" style="color: #4ec9b0;"></div>
                            <span class="typing-cursor" style="display:inline-block; width:8px; height:14px; background:#ccc; vertical-align:middle;"></span>
                        </div>
                    </div>
                </div>
            </div>

            <div id="seat-result-area" style="display:none;">
                 <div class="main-card-wrapper">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">🏫 教室座位预览</h3>
                        <button id="btn-export-seats" class="sidebar-button" style="background-color: var(--color-blue);">📥 导出Excel</button>
                    </div>
                    <div id="seat-map-container" style="overflow-x:auto; padding:20px; background:#fdfdfd; border:1px solid #eee; text-align:center;"></div>
                </div>
            </div>
        </div>
    `;

    // --- 辅助：恢复 Tab 1 的 HTML (避免代码重复太长) ---
    // 在实际文件中，你可以把原来 Tab 1 的 HTML 直接贴在上面的 ${getTab1HTML} 位置
    // 这里为了演示，我用一个占位符，您操作时请直接保留原有的 Tab 1 内容即可。

    // Tab 切换逻辑
    window.switchGroupTab = (tab) => {
        document.getElementById('tab-content-study').style.display = tab === 'study' ? 'block' : 'none';
        document.getElementById('tab-content-seat').style.display = tab === 'seat' ? 'block' : 'none';
        const btnStudy = document.getElementById('tab-btn-study');
        const btnSeat = document.getElementById('tab-btn-seat');
        if (tab === 'study') {
            btnStudy.style.borderBottomColor = '#6f42c1'; btnStudy.style.color = '#6f42c1';
            btnSeat.style.borderBottomColor = 'transparent'; btnSeat.style.color = '#666';
        } else {
            btnSeat.style.borderBottomColor = '#20c997'; btnSeat.style.color = '#20c997';
            btnStudy.style.borderBottomColor = 'transparent'; btnStudy.style.color = '#666';
        }
    };

    // 绑定事件
    bindStudyGroupEvents();
    initGroupArchiveManager(); 
    initPhysicalDataManager(); 
    
    // [新增] AI 按钮绑定
    document.getElementById('btn-generate-ai-seats').addEventListener('click', generateAISeatingChart);
    document.getElementById('btn-export-seats').addEventListener('click', exportSeatingChart);
}

function getTab1HTML(classes, subjectOptions) {
    return `
            <div class="main-card-wrapper" style="margin-bottom: 20px; background:#f8f9fa; border:1px dashed #ccc;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0; color:#555;">💾 分组存档库</h4>
                    <button id="btn-save-group-archive" class="sidebar-button" style="background-color:#28a745; font-size:0.85em;" disabled>💾 保存当前分组</button>
                </div>
                <div id="group-archive-list" style="margin-top:10px; max-height:150px; overflow-y:auto; background:#fff; border:1px solid #eee; padding:5px; border-radius:4px;">
                    <div style="text-align:center; color:#999; padding:10px;">正在加载存档...</div>
                </div>
            </div>
            <div class="main-card-wrapper" style="border-left: 5px solid #6f42c1;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">
                    <h4 style="margin:0;">🛠️ 策略配置</h4>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; align-items: end;">
                    <div><label style="font-weight:600; font-size:0.9em; color:#555;">1. 选择班级</label><select id="group-class-select" class="sidebar-select" style="width:100%; font-weight:bold;">${classes.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
                    <div><label style="font-weight:600; font-size:0.9em; color:#555;">2. 分组模式</label><select id="group-strategy" class="sidebar-select" style="width:100%;"><option value="balanced">⚖️ S型均衡分组 (推荐)</option><option value="high_low">🤝 1帮1 (首尾结对)</option><option value="random">🎲 完全随机</option></select></div>
                    <div><label style="font-weight:600; font-size:0.9em; color:#555;">3. 核心依据</label><select id="group-sort-basis" class="sidebar-select" style="width:100%; color:#6f42c1; font-weight:bold;"><option value="total">🏆 按“总分”实力</option><option value="single">🎯 按“单科”成绩</option><option value="complementary">☯️ 按“双科互补” (A强B弱)</option></select></div>
                    <div id="group-params-area" style="grid-column: span 1;">
                        <div id="group-size-wrapper"><label style="font-weight:600; font-size:0.9em; color:#555;">每组人数</label><input type="number" id="group-size-input" class="sidebar-select" value="6" min="2" max="10" style="width:100%;"></div>
                        <div id="group-single-wrapper" style="display:none;"><label style="font-weight:600; font-size:0.9em; color:#555;">选择目标学科</label><select id="group-single-subject" class="sidebar-select" style="width:100%;">${subjectOptions}</select></div>
                        <div id="group-comp-wrapper" style="display:none;"><label style="font-weight:600; font-size:0.9em; color:#555;">互补学科 (A vs B)</label><div style="display:flex; gap:5px;"><select id="group-sub-a" class="sidebar-select" style="width:50%;">${subjectOptions}</select><span style="align-self:center;">⚡️</span><select id="group-sub-b" class="sidebar-select" style="width:50%;">${subjectOptions}</select></div></div>
                    </div>
                    <div><button id="btn-generate-groups" class="sidebar-button" style="background-color: #6f42c1; width:100%; height: 42px;">✨ 生成分组</button></div>
                </div>
                <div id="group-strategy-desc" style="font-size:0.85em; color:#666; margin-top:15px; padding:10px; background:#f8f9fa; border-radius:6px;"></div>
            </div>
            <div id="group-result-area" style="display: none;">
                <div class="main-card-wrapper">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;"><h3 style="margin:0;">📋 分组结果预览</h3><button id="btn-export-groups" class="sidebar-button" style="background-color: var(--color-green);">📥 导出名单</button></div>
                    <div id="group-stats-bar" style="background:#fff3cd; padding:10px; border-radius:6px; margin-bottom:15px; font-size:0.9em; color:#856404; border:1px solid #ffeeba;"></div>
                    <div id="group-cards-container" class="group-grid-container"></div>
                </div>
            </div>
    `;
}


/**
 * 16.2 分组核心算法 (适配多模式)
 */
function calculateGroups(students, strategy, groupSize, sortMode) {
    const groups = [];
    const totalStudents = students.length;

    // --- 随机模式 ---
    if (strategy === 'random') {
        const shuffled = [...students].sort(() => Math.random() - 0.5);
        const numGroups = Math.ceil(totalStudents / groupSize);
        for (let i = 0; i < numGroups; i++) groups.push({ name: `第 ${i + 1} 组`, members: [] });
        shuffled.forEach((s, idx) => groups[idx % numGroups].members.push(s));
        return groups;
    }

    // --- 1帮1模式 (High-Low) ---
    if (strategy === 'high_low') {
        const pairCount = Math.floor(totalStudents / 2);
        for (let i = 0; i < pairCount; i++) {
            const top = students[i];
            const bottom = students[totalStudents - 1 - i];

            // 在互补模式下，Top是 A强B弱，Bottom是 A弱B强。绝配！
            groups.push({
                name: sortMode === 'complementary' ? `互补对子 ${i + 1}` : `帮扶对子 ${i + 1}`,
                members: [top, bottom]
            });
        }
        // 处理落单 (奇数)
        if (totalStudents % 2 !== 0) {
            const midStudent = students[Math.floor(totalStudents / 2)];
            groups[groups.length - 1].members.push(midStudent); // 加到最后一组变3人
        }
    }
    // --- S型均衡模式 (Balanced) ---
    else {
        const numGroups = Math.ceil(totalStudents / groupSize);
        for (let i = 0; i < numGroups; i++) groups.push({ name: `第 ${i + 1} 组`, members: [] });

        students.forEach((s, index) => {
            const row = Math.floor(index / numGroups);
            let groupIndex;
            if (row % 2 === 0) groupIndex = index % numGroups; // 正向
            else groupIndex = numGroups - 1 - (index % numGroups); // 反向
            groups[groupIndex].members.push(s);
        });
    }

    // 计算统计信息 (均分/均差)
    groups.forEach(g => {
        let sum = 0;
        g.members.forEach(m => sum += m._sortScore);
        g.avgSortScore = (sum / g.members.length).toFixed(1);

        // 组内排序 (方便显示 Leader)
        g.members.sort((a, b) => b._sortScore - a._sortScore);

        // 角色标记
        g.members.forEach((m, idx) => {
            if (sortMode === 'complementary') {
                // 互补模式下，没有绝对的优差，而是特质不同
                // 排序分高(A强B弱)，排序分低(B强A弱)
                if (m._compDiff > 5) m.role = 'typeA'; // A科大佬
                else if (m._compDiff < -5) m.role = 'typeB'; // B科大佬
                else m.role = 'balance'; // 均衡
            } else {
                // 传统优差
                if (idx === 0) m.role = 'leader';
                else if (idx === g.members.length - 1) m.role = 'support';
                else m.role = 'member';
            }
        });
    });

    return groups;
}

/**
 * 16.3 渲染可视化 (  强版)
 */
function renderGroupVisuals(groups, className, sortMode) {
    const container = document.getElementById('group-cards-container');
    const statsBar = document.getElementById('group-stats-bar');
    document.getElementById('group-result-area').style.display = 'block';

    // 统计描述
    let statText = `<strong>${className}</strong> 生成 <strong>${groups.length}</strong> 组。`;
    if (sortMode !== 'complementary' && groups.length > 0) {
        const max = Math.max(...groups.map(g => parseFloat(g.avgSortScore)));
        const min = Math.min(...groups.map(g => parseFloat(g.avgSortScore)));
        statText += ` 组间指标极差：<strong>${(max - min).toFixed(1)}</strong> (越小越均衡)`;
    } else {
        statText += ` 已尝试最大化组内互补性。`;
    }
    statsBar.innerHTML = statText;

    container.innerHTML = groups.map(g => `
        <div class="group-card">
            <div class="group-header">
                <span>${g.name}</span>
                <span class="group-avg" style="font-size:0.8em; opacity:0.7;">指标均值:${g.avgSortScore}</span>
            </div>
            <ul class="group-member-list">
                ${g.members.map(m => {
        let badge = '';
        let scoreColor = '#666';

        if (sortMode === 'complementary') {
            if (m.role === 'typeA') {
                badge = `<span class="role-badge" style="background:#e3f2fd; color:#0d47a1;">A强</span>`;
                scoreColor = '#0d47a1';
            } else if (m.role === 'typeB') {
                badge = `<span class="role-badge" style="background:#fbe9e7; color:#bf360c;">B强</span>`;
                scoreColor = '#bf360c';
            } else {
                badge = `<span class="role-badge" style="background:#f5f5f5; color:#666;">均衡</span>`;
            }
        } else {
            if (m.role === 'leader') badge = `<span class="role-badge role-leader">Leader</span>`;
            else if (m.role === 'support') badge = `<span class="role-badge role-support">Help</span>`;
        }

        return `
                    <li class="group-member-item">
                        <div style="font-weight:500;">
                            ${m.name} ${badge}
                        </div>
                        <div style="font-size:0.85em; color:${scoreColor};">
                            ${m._displayInfo}
                        </div>
                    </li>`;
    }).join('')}
            </ul>
        </div>
    `).join('');
}

/**
 * 16.4 导出 (适配 Pro 版)
 */
function exportGroupsToExcel(groups) {
    const wb = XLSX.utils.book_new();
    const data = [];

    // 1. 设置表头
    data.push(["小组名称", "姓名", "组内角色", "排序指标数据 (分数/差值)"]);

    // 2. 填充数据
    groups.forEach(g => {
        g.members.forEach(m => {
            let roleText = m.role;

            // 角色名称映射 (对应 renderVisuals 中的逻辑)
            if (roleText === 'leader') roleText = '🌟 组长';
            else if (roleText === 'support') roleText = '💪 帮扶对象';
            else if (roleText === 'member') roleText = '组员';
            else if (roleText === 'typeA') roleText = '🔵 A科优势';
            else if (roleText === 'typeB') roleText = '🔴 B科优势';
            else if (roleText === 'balance') roleText = '⚪ 均衡';

            data.push([
                g.name,
                m.name,
                roleText,
                m._displayInfo // 这里会显示 "总分:500" 或 "数学:90 / 英语:60"
            ]);
        });

        // 每个小组之间插入空行，方便阅读
        data.push([]);
    });

    // 3. 生成 Sheet
    const ws = XLSX.utils.aoa_to_sheet(data);

    // 4. 设置列宽 (wch 是字符宽度)
    ws['!cols'] = [
        { wch: 12 }, // 小组名称
        { wch: 10 }, // 姓名
        { wch: 12 }, // 组内角色
        { wch: 30 }  // 排序指标数据 (这一列可能较长，给宽一点)
    ];

    // 5. 写入并下载
    XLSX.utils.book_append_sheet(wb, ws, "互助分组名单");
    XLSX.writeFile(wb, `智能互助分组名单_${new Date().toLocaleDateString()}.xlsx`);
}


// =====================================================================
//    UPGRADED V3    模块十七：学期综合评语助手 (成绩 + 生活双维度)
// =====================================================================

// 预设的日常行为标签库 (点击可快速插入)
// 预设的日常行为标签库 (点击可快速插入)
const DAILY_TAGS = [
    // --- 👍 学习与态度 ---
    { text: "👂 听课专注", type: "good" },
    { text: "🧠 思维敏捷", type: "good" },
    { text: "🙋 积极发言", type: "good" },
    { text: "📝 书写美观", type: "good" },
    { text: "📚 热爱阅读", type: "good" },
    { text: "🦅 敢于质疑", type: "good" },
    { text: "🐢 作业拖拉", type: "bad" },
    { text: "📉 粗心大意", type: "bad" },
    { text: "💤 上课走神", type: "bad" },
    { text: "🤫 爱讲小话", type: "bad" },

    // --- 🌟 性格与品质 ---
    { text: "🌞 阳光开朗", type: "good" },
    { text: "💼 责任心强", type: "good" },
    { text: "💪 意志坚强", type: "good" },
    { text: "😊 礼貌待人", type: "good" },
    { text: "🤐 性格内向", type: "neutral" },
    { text: "😶 缺乏自信", type: "bad" },
    { text: "🤯 情绪波动大", type: "bad" },
    { text: "🧊 个性独立", type: "neutral" },

    // --- 🤝 社交与集体 ---
    { text: "🤝 乐于助人", type: "good" },
    { text: "🏆 集体荣誉感", type: "good" },
    { text: "👮 优秀班干", type: "good" },
    { text: "👥 人缘极好", type: "good" },
    { text: "🌵 容易起摩擦", type: "bad" },
    { text: "🧐 爱钻牛角尖", type: "neutral" },

    // --- 🏃 综合与特长 ---
    { text: "🔥 劳动积极", type: "good" },
    { text: "🏃 体育健将", type: "good" },
    { text: "🎨 艺术特长", type: "good" },
    { text: "💻 电脑高手", type: "good" },
    { text: "🕰️ 经常迟到", type: "bad" },
    { text: "🧹 卫生习惯差", type: "bad" }
];
/**
 * 17.1 渲染主界面
 */
async function renderCommentGenerator(container) {
    const multiData = await loadMultiExamData();

    if (!multiData || multiData.length === 0) {
        container.innerHTML = `<div class="main-card-wrapper" style="text-align:center; padding:50px; color:#666;">⚠️ 请先在“数据管理中心”导入考试数据。</div>`;
        return;
    }

    // 1. 数据聚合
    const studentMap = new Map();
    const classSet = new Set();

    multiData.forEach(exam => {
        if (exam.isHidden) return;
        exam.students.forEach(s => {
            if (!studentMap.has(s.id)) {
                studentMap.set(s.id, {
                    info: { name: s.name, class: s.class, id: s.id },
                    exams: []
                });
            }
            const record = studentMap.get(s.id);
            record.info.class = s.class;
            classSet.add(s.class);
            record.exams.push({
                label: exam.label,
                totalScore: s.totalScore,
                rank: s.rank,
                gradeRank: s.gradeRank
            });
        });
    });

    const classes = Array.from(classSet).sort();

    //            排序状态变量 (默认为 rank)
    let currentSortMode = 'rank';

    // 2. 渲染 UI
    container.innerHTML = `
        <h2>✍️ 模块十七：综合评语助手</h2>

        <div class="main-card-wrapper" style="border-left: 5px solid #20c997; margin-bottom: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <div>
                        <label style="font-weight:600; font-size:0.9em; color:#555;">班级:</label>
                        <select id="comment-class-select" class="sidebar-select" style="width:auto; min-width:120px; font-weight:bold;">
                            ${classes.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <label style="font-weight:600; font-size:0.9em; color:#6f42c1;">依据:</label>
                        <select id="comment-gen-mode" class="sidebar-select" style="width:auto; min-width:180px; border-color:#6f42c1; color:#6f42c1; font-weight:bold;">
                            <option value="comprehensive" selected>🌟 综合 (历史趋势+日常)</option>
                            <option value="history_only">📈 仅历史成绩趋势</option>
                            <option value="current_only">🎯 仅本次成绩</option>
                            <option value="daily_only">📝 仅日常行为表现</option>
                        </select>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="btn-toggle-archive" class="sidebar-button" style="background-color: #6c757d; font-size: 0.9em;">📂 评语存档库</button>
                    <button id="btn-gen-rule" class="sidebar-button" style="background-color: #17a2b8; font-size: 0.9em;">⚡️ 规则生成</button>
                    <button id="btn-gen-ai-batch" class="sidebar-button" style="background-color: #6f42c1; font-size: 0.9em;">🤖 AI 批量生成</button>
                    <button id="btn-export-comments" class="sidebar-button" style="background-color: var(--color-green); font-size: 0.9em;">📥 导出</button>
                </div>
            </div>

            <div id="archive-panel" style="display:none; margin-top:15px; padding-top:15px; border-top:1px dashed #ccc; background-color:#fcfcfc; padding:15px; border-radius:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h4 style="margin:0; font-size:1em; color:#555;">📚 历史评语存档</h4>
                    <button id="btn-save-library" class="sidebar-button" style="background-color: #28a745; padding:4px 10px; font-size: 0.8em;">💾 保存当前表格</button>
                </div>
                <div id="comment-library-list" style="max-height: 150px; overflow-y: auto; border:1px solid #eee; background:#fff; border-radius:4px;">
                    <div style="padding:15px; text-align:center; color:#999;">加载中...</div>
                </div>
            </div>
            
            <div id="ai-batch-progress" style="display:none; margin-top:15px; background:#fff; padding:10px; border:1px solid #e9ecef; border-radius:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.9em; margin-bottom:5px;">
                    <span id="ai-progress-text" style="font-weight:bold; color:#555;">AI 生成中...</span>
                    <div style="display:flex; gap:10px;">
                        <button id="btn-stop-ai" style="color:#dc3545; background:none; border:none; font-weight:bold; cursor:pointer;">⏹ 停止</button>
                        <button id="btn-close-progress" style="color:#999; background:none; border:none; font-size:1.2em; cursor:pointer;">&times;</button>
                    </div>
                </div>
                <div style="width:100%; background:#e9ecef; height:8px; border-radius:4px; overflow:hidden;">
                    <div id="ai-progress-bar" style="width:0%; height:100%; background:#6f42c1; transition:width 0.3s;"></div>
                </div>
            </div>
        </div>

        <div class="main-card-wrapper">
            <div class="table-container" style="max-height: 65vh; overflow-y: auto;">
                <table id="comment-table">
                    <thead>
                        <tr>
                            <th id="th-sort-name" style="width:70px; cursor:pointer; user-select:none;" title="点击切换：按成绩排序 / 按姓名排序">
                                姓名 <span id="sort-icon" style="font-size:0.8em; color:#ccc;">⇅</span>
                            </th>
                            <th style="width:120px;">成绩趋势</th>
                            <th style="width:250px; background-color:#fff9db;">📝 日常印象 (关键词)</th>
                            <th>评语内容 (AI / 规则)</th>
                            <th style="width:60px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="comment-tbody"></tbody>
                </table>
            </div>
        </div>
    `;

    // --- 功能逻辑区域 ---

    // 1. 存档库折叠逻辑
    const archiveBtn = document.getElementById('btn-toggle-archive');
    const archivePanel = document.getElementById('archive-panel');
    archiveBtn.addEventListener('click', () => {
        if (archivePanel.style.display === 'none') {
            archivePanel.style.display = 'block';
            renderLibraryList(); // 展开时刷  列表
            archiveBtn.style.backgroundColor = '#5a6268'; // 深色表示激活
        } else {
            archivePanel.style.display = 'none';
            archiveBtn.style.backgroundColor = '#6c757d'; // 恢复原色
        }
    });

    // --- 内部函数：渲染归档库列表 (已升级：添加重命名按钮) ---
    const renderLibraryList = async () => {
        const libContainer = document.getElementById('comment-library-list');
        const library = await localforage.getItem('G_Comment_Library') || [];

        if (library.length === 0) {
            libContainer.innerHTML = `<div style="padding:15px; text-align:center; color:#999;">暂无存档，点击绿色按钮保存当前工作。</div>`;
            return;
        }

        libContainer.innerHTML = library.map((item) => `
            <div class="multi-exam-item" style="padding:8px 12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div style="flex-grow:1;">
                    <div style="font-weight:bold; color:#333; font-size:0.95em;">${item.name}</div>
                    <div style="font-size:0.8em; color:#999;">📅 ${item.date} | 👥 ${item.count} 人</div>
                </div>
                <div style="display:flex; gap:5px;">
                    <button onclick="window.loadCommentLibrary('${item.id}')" class="sidebar-button" style="padding:3px 8px; font-size:0.8em; background-color:#17a2b8;">📥 读取</button>
                    
                    <button onclick="window.renameCommentLibrary('${item.id}')" class="sidebar-button" style="padding:3px 8px; font-size:0.8em; background-color:#fd7e14;">✏️ 重命名</button>
                    
                    <button onclick="window.deleteCommentLibrary('${item.id}')" class="sidebar-button" style="padding:3px 8px; font-size:0.8em; background-color:#fff; color:#dc3545; border:1px solid #dc3545;">删除</button>
                </div>
            </div>
        `).join('');
    };

    // 3. 存档操作 (Save/Load/Delete)
    document.getElementById('btn-save-library').addEventListener('click', async () => {
        const rows = document.querySelectorAll('.comment-row');
        if (rows.length === 0) return;
        const name = prompt("请输入存档名称 (例如：2024秋-期末评语):", "  评语存档");
        if (!name) return;

        const dataToSave = {};
        rows.forEach(row => {
            const rec = JSON.parse(decodeURIComponent(row.dataset.history));
            dataToSave[rec.info.id] = {
                daily: row.querySelector('.daily-input').value,
                comment: row.querySelector('.result-textarea').value
            };
        });

        let library = await localforage.getItem('G_Comment_Library') || [];
        library.unshift({
            id: Date.now().toString(),
            name: name,
            date: new Date().toLocaleString(),
            count: Object.keys(dataToSave).length,
            data: dataToSave
        });
        await localforage.setItem('G_Comment_Library', library);
        renderLibraryList();
        alert("✅ 存档成功！");
    });

    window.loadCommentLibrary = async (id) => {
        if (!confirm("确定读取该存档吗？当前表格内容将被覆盖。")) return;
        const library = await localforage.getItem('G_Comment_Library') || [];
        const record = library.find(r => r.id === id);
        if (record) {
            const rows = document.querySelectorAll('.comment-row');
            let matchCount = 0;
            rows.forEach(row => {
                const rec = JSON.parse(decodeURIComponent(row.dataset.history));
                const saved = record.data[rec.info.id];
                if (saved) {
                    row.querySelector('.daily-input').value = saved.daily || "";
                    row.querySelector('.result-textarea').value = saved.comment || "";
                    matchCount++;
                }
            });
            alert(`✅ 已恢复 ${matchCount} 条数据。`);
        }
    };

    window.deleteCommentLibrary = async (id) => {
        if (!confirm("确定删除？")) return;
        let library = await localforage.getItem('G_Comment_Library') || [];
        library = library.filter(r => r.id !== id);
        await localforage.setItem('G_Comment_Library', library);
        renderLibraryList();
    };

    //            全局重命名函数
    window.renameCommentLibrary = async (id) => {
        let library = await localforage.getItem('G_Comment_Library') || [];
        const item = library.find(r => r.id === id);

        if (!item) return;

        // 弹出输入框，默认显示旧名称
        const newName = prompt("重命名存档:", item.name);

        // 校验输入
        if (newName === null || newName.trim() === "") return;

        // 更  名称并保存
        item.name = newName.trim();
        await localforage.setItem('G_Comment_Library', library);

        // 刷  列表
        renderLibraryList();
    };

    // --- 核心逻辑：渲染表格 ---
    const renderTable = (className) => {
        const tbody = document.getElementById('comment-tbody');
        let rowsHtml = '';
        const classStudents = [];
        studentMap.forEach(record => {
            if (record.info.class === className) classStudents.push(record);
        });

        //    修改    根据 currentSortMode 进行排序
        if (currentSortMode === 'name') {
            // 按姓名拼音排序
            classStudents.sort((a, b) => a.info.name.localeCompare(b.info.name, 'zh-CN'));
        } else {
            // 默认：按最  一次考试排名排序
            classStudents.sort((a, b) => {
                const lastRankA = a.exams[a.exams.length - 1].rank || 9999;
                const lastRankB = b.exams[b.exams.length - 1].rank || 9999;
                return lastRankA - lastRankB;
            });
        }

        classStudents.forEach(record => {
            const exams = record.exams;
            const count = exams.length;
            let trendHtml = '<span style="color:#ccc">-</span>';

            if (count >= 2) {
                const ranks = exams.map(e => e.gradeRank || e.rank || 0);
                // 假设 calculateTrendSlope 函数已存在于 script.js 底部
                const slope = (typeof calculateTrendSlope === 'function') ? calculateTrendSlope(ranks) : 0;
                const trendScore = Math.round(slope * (count - 1) * -1);

                if (trendScore > 20) trendHtml = `<span class="progress">🚀 升 ${trendScore}</span>`;
                else if (trendScore > 5) trendHtml = `<span class="progress" style="color:#20c997">📈 升 ${trendScore}</span>`;
                else if (trendScore < -20) trendHtml = `<span class="regress">📉 降 ${Math.abs(trendScore)}</span>`;
                else if (trendScore < -5) trendHtml = `<span class="regress" style="color:#fd7e14">📉 降 ${Math.abs(trendScore)}</span>`;
                else trendHtml = `<span style="color:#007bff">⚖️ 稳定</span>`;
            }

            const historyJson = encodeURIComponent(JSON.stringify(record));
            //    修改    直接显示文本，并根据类型给一点颜色提示 (可选)
            const tagsHtml = DAILY_TAGS.map(tag => {
                let colorStyle = '';
                if (tag.type === 'good') colorStyle = 'color: #28a745; border-color: #c3e6cb; background-color: #f0fff4;';
                if (tag.type === 'bad') colorStyle = 'color: #dc3545; border-color: #f5c6cb; background-color: #fff5f5;';
                if (tag.type === 'neutral') colorStyle = 'color: #6c757d; border-color: #d6d8db; background-color: #f8f9fa;';

                return `<span class="quick-tag" style="${colorStyle}" onclick="addTag(this, '${tag.text}')" title="${tag.text}">${tag.text}</span>`;
            }).join('');
            //const tagsHtml = DAILY_TAGS.map(tag => `<span class="quick-tag" onclick="addTag(this, '${tag.text}')" title="${tag.text}">${tag.text.split(' ')[1]}</span>`).join('');

            rowsHtml += `
                <tr class="comment-row" data-history="${historyJson}">
                    <td style="font-weight:bold;">${record.info.name}</td>
                    <td style="font-size:0.9em;">${trendHtml}</td>
                    <td style="vertical-align:top;">
                        <input type="text" class="daily-input sidebar-select" style="width:90%; margin-bottom:5px; font-size:0.9em;" placeholder="例: 乐于助人...">
                        
                        <div style="display:flex; flex-wrap:wrap; gap:10px; max-height:200px; overflow-y:auto;">
                            ${tagsHtml}
                        </div>
                    </td>
                    <td style="padding:10px;">
                        <textarea class="result-textarea sidebar-select" style="width:100%; height:220px; border:1px solid #eee; resize:vertical; font-family:inherit; line-height:1.4;"></textarea>
                    </td>
                    <td>
                        <button class="btn-single-ai sidebar-button" style="font-size:1.2em; padding:8px 16px; background-color:#6f42c1;">🤖</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = rowsHtml;
        bindRowEvents();

        // 更  图标状态
        const sortIcon = document.getElementById('sort-icon');
        if (sortIcon) {
            sortIcon.style.color = currentSortMode === 'name' ? '#007bff' : '#ccc';
            sortIcon.innerText = currentSortMode === 'name' ? '🔤' : '⇅';
        }

    };

    // --- 绑定事件 ---
    const classSelect = document.getElementById('comment-class-select');
    classSelect.addEventListener('change', () => renderTable(classSelect.value));
    if (classes.length > 0) renderTable(classes[0]);

    //            绑定表头点击排序
    document.getElementById('th-sort-name').addEventListener('click', () => {
        // 切换模式
        currentSortMode = (currentSortMode === 'rank') ? 'name' : 'rank';
        // 重  渲染
        renderTable(classSelect.value);
    });

    // 5. 其他按钮绑定
    window.addTag = (span, text) => {
        const row = span.closest('td');
        const input = row.querySelector('input');
        const clean = text.replace(/^[^\s]+\s/, '');
        if (!input.value.includes(clean)) input.value = input.value ? input.value + "，" + clean : clean;
    };

    document.getElementById('btn-export-comments').addEventListener('click', exportCommentsToExcel);

    //    修改    规则生成 (支持多模式)
    document.getElementById('btn-gen-rule').addEventListener('click', () => {
        const mode = document.getElementById('comment-gen-mode').value; // 获取当前模式

        document.querySelectorAll('.comment-row').forEach(row => {
            const record = JSON.parse(decodeURIComponent(row.dataset.history));
            const dailyText = row.querySelector('.daily-input').value; // 获取日常标签文本

            // 调用  的分流函数
            const result = generateModeRuleComment(record, dailyText, mode);
            row.querySelector('.result-textarea').value = result;
        });
    });

    // 批量 AI
    let aiController = null;
    document.getElementById('btn-gen-ai-batch').addEventListener('click', async () => {
        const apiKey = localStorage.getItem('G_DeepSeekKey');
        if (!apiKey) { alert("请先设置 API Key"); return; }
        const rows = Array.from(document.querySelectorAll('.comment-row'));
        if (rows.length === 0) return;

        const mode = document.getElementById('comment-gen-mode').value;
        const modeText = document.getElementById('comment-gen-mode').selectedOptions[0].text;

        if (!confirm(`即将按【${modeText}】模式为 ${rows.length} 人生成评语。\n确定吗？`)) return;

        document.getElementById('ai-batch-progress').style.display = 'block';
        if (aiController) aiController.abort();
        aiController = new AbortController();
        let completed = 0;

        for (const row of rows) {
            if (aiController.signal.aborted) break;
            const record = JSON.parse(decodeURIComponent(row.dataset.history));
            const daily = row.querySelector('.daily-input').value || "";
            const textarea = row.querySelector('.result-textarea');

            document.getElementById('ai-progress-text').innerText = `🤖 正在生成: ${record.info.name} (${completed + 1}/${rows.length})`;

            try {
                const comment = await fetchMultiModeAIComment(apiKey, record, daily, mode, aiController.signal);
                textarea.value = comment;
                completed++;
                document.getElementById('ai-progress-bar').style.width = `${(completed / rows.length) * 100}%`;
                await new Promise(r => setTimeout(r, 600));
            } catch (e) { if (e.name !== 'AbortError') textarea.value = `[Error] ${e.message}`; }
        }
        if (!aiController.signal.aborted) {
            document.getElementById('ai-progress-text').innerText = "✅ 完成！";
            setTimeout(() => document.getElementById('ai-batch-progress').style.display = 'none', 3000);
        }
    });

    // 停止/关闭逻辑
    document.getElementById('btn-stop-ai').addEventListener('click', () => {
        if (aiController) { aiController.abort(); document.getElementById('ai-progress-text').innerText = "🛑 已停止"; }
    });
    document.getElementById('btn-close-progress').addEventListener('click', () => {
        if (aiController) aiController.abort();
        document.getElementById('ai-batch-progress').style.display = 'none';
    });
}

/**
 * 17.2 辅助：绑定行内按钮
 */
function bindRowEvents() {
    document.querySelectorAll('.btn-single-ai').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const row = e.target.closest('tr');
            const record = JSON.parse(decodeURIComponent(row.dataset.history));
            const dailyText = row.querySelector('.daily-input').value || "";
            const textarea = row.querySelector('.result-textarea');
            const mode = document.getElementById('comment-gen-mode').value; // 获取当前模式

            const apiKey = localStorage.getItem('G_DeepSeekKey');
            if (!apiKey) { alert("请设置 API Key"); return; }

            const originalText = e.target.innerText;
            e.target.innerText = "⏳";
            e.target.disabled = true;

            try {
                const comment = await fetchMultiModeAIComment(apiKey, record, dailyText, mode);
                textarea.value = comment;
            } catch (err) {
                alert(err.message);
            } finally {
                e.target.innerText = originalText;
                e.target.disabled = false;
            }
        });
    });
}



/**
 * 17.3    AI 生成逻辑 (支持 4 种模式)
 */
async function fetchMultiModeAIComment(apiKey, record, dailyInfo, mode, signal) {
    let promptContext = "";
    let promptInstruction = "";
    const exams = record.exams;
    const hasExams = exams && exams.length > 0;

    // --- 模式 1: 综合评价 (Comprehensive) ---
    if (mode === 'comprehensive') {
        // 构建历史成绩串
        let historyStr = hasExams ? exams.map((e, i) => `${i + 1}. ${e.label}: 总分${e.totalScore} (班排${e.rank || '-'})`).join('\n') : "（暂无考试数据）";
        promptContext = `
【学习数据】：
${historyStr}
【日常表现】：
${dailyInfo || "（表现中规中矩）"}
        `;
        promptInstruction = `请结合【学习成绩变化趋势】和【日常表现】，写一段期末综合评语。学习和生活比重各占50%。将两者自然融合。`;
    }

    // --- 模式 2: 仅历史趋势 (History Only) ---
    else if (mode === 'history_only') {
        let historyStr = hasExams ? exams.map((e, i) => `${i + 1}. ${e.label}: 总分${e.totalScore} (年排${e.gradeRank || '-'}, 班排${e.rank || '-'})`).join('\n') : "（暂无数据）";
        promptContext = `【历次考试数据】：\n${historyStr}`;
        promptInstruction = `请仅根据【历次成绩变化趋势】，点评其学习状态的稳定性或进退步情况，给出针对性的学习建议。忽略生活表现。`;
    }

    // --- 模式 3: 仅本次成绩 (Current Only) ---
    else if (mode === 'current_only') {
        let currentStr = "（无数据）";
        if (hasExams) {
            const last = exams[exams.length - 1];
            currentStr = `考试名称：${last.label}\n总分：${last.totalScore}\n班级排名：${last.rank}\n年级排名：${last.gradeRank || '-'}`;
        }
        promptContext = `【本次考试数据】：\n${currentStr}`;
        promptInstruction = `请仅针对【本次考试】的发挥情况进行点评。不要提及之前的考试，也不要提及生活表现。`;
    }

    // --- 模式 4: 仅日常表现 (Daily Only) ---
    else if (mode === 'daily_only') {
        promptContext = `【日常表现关键词】：\n${dailyInfo || "遵守纪律，尊敬师长"}`;
        promptInstruction = `请仅根据【日常表现关键词】，扩写成一段生动的德育评语。重点描述性格、品德和习惯。忽略成绩数据。`;
    }

    const prompt = `
你是一位温暖、专业的班主任。请为学生【${record.info.name}】写评语。
${promptContext}

【写作要求】：
1. ${promptInstruction}
2. 语气亲切，使用第二人称“你”。
3. 字数控制在 80-120 字。
4. 不要出现“根据数据”、“如图所示”等机械语言。
    `.trim();

    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        signal: signal,
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        })
    });

    if (!response.ok) throw new Error("API Error");
    const data = await response.json();
    return data.choices[0].message.content.trim();
}

/**
 * 17.5 导出
 */
function exportCommentsToExcel() {
    const className = document.getElementById('comment-class-select').value;
    const rows = Array.from(document.querySelectorAll('.comment-row'));
    const data = [];
    data.push(["班级", "姓名", "日常标签", "最终评语"]);
    rows.forEach(row => {
        const record = JSON.parse(decodeURIComponent(row.dataset.history));
        const daily = row.querySelector('.daily-input').value;
        const comment = row.querySelector('.result-textarea').value;
        data.push([record.info.class, record.info.name, daily, comment]);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "评语");
    XLSX.writeFile(wb, `${className}_评语表.xlsx`);
}

// =====================================================================
//    NEW    多模式规则评语生成引擎
// =====================================================================

/**
 * 总入口：根据模式分发逻辑
 */
function generateModeRuleComment(record, dailyText, mode) {
    switch (mode) {
        case 'history_only':
            return generateHistoryRuleComment(record); // (复用原有逻辑)
        case 'current_only':
            return generateCurrentRuleComment(record); // (    )
        case 'daily_only':
            return generateDailyRuleComment(record, dailyText); // (    )
        case 'comprehensive':
        default:
            return generateComprehensiveRuleComment(record, dailyText); // (    )
    }
}

/**
 * 1. [仅历史] (这是您原有的逻辑，稍微优化)
 */
function generateHistoryRuleComment(record) {
    const exams = record.exams;
    if (!exams || exams.length === 0) return "暂无考试数据。";

    const name = record.info.name;
    const count = exams.length;
    const first = exams[0].gradeRank || exams[0].rank;
    const last = exams[count - 1].gradeRank || exams[count - 1].rank;
    const diff = first - last;

    let text = `本学期 ${name} 同学共参加了 ${count} 次大考。`;

    if (diff > 20) text += `成绩呈现显著的上升趋势，排名从期初的 ${first} 名进步至期末的 ${last} 名，进步幅度很大，值得表扬。`;
    else if (diff > 5) text += `成绩稳中有升，排名较期初进步了 ${diff} 名，学习状态渐入佳境。`;
    else if (diff < -20) text += `成绩出现了一定幅度的下滑，排名从 ${first} 名退至 ${last} 名，建议假期好好调整状态，查缺补漏。`;
    else text += `成绩保持相对稳定，排名始终维持在 ${last} 名左右，基础较为扎实。`;

    return text;
}

/**
 * 2. [仅本次] 只关注最后一次考试
 */
function generateCurrentRuleComment(record) {
    const exams = record.exams;
    if (!exams || exams.length === 0) return "暂无本次考试数据。";

    const lastExam = exams[exams.length - 1]; // 取最后一次
    const rank = lastExam.gradeRank || lastExam.rank;
    const score = lastExam.totalScore;
    const name = record.info.name;

    let text = `在本次${lastExam.label}中，${name} 同学取得了总分 ${score} 分，年级排名 ${rank} 名的成绩。`;

    // 简单排位判断 (假设年段人数 500，可根据实际调整)
    if (rank <= 50) text += ` 表现非常优异，名列年段前茅，展现了扎实的学科功底。`;
    else if (rank <= 150) text += ` 成绩良好，处于年段上游水平，若能补齐弱项，冲击顶尖指日可待。`;
    else if (rank <= 350) text += ` 成绩处于中游，基础尚可，但部分学科存在失分点，需要更有针对性的练习。`;
    else text += ` 成绩暂时不理想，基础知识掌握不够牢固，希望你能正视差距，奋起直追。`;

    text += ` 希望你能胜不骄败不馁，在接下来的学习中继续努力。`;
    return text;
}

/**
 * 3. [仅日常] 根据关键词生成德育评语
 */
function generateDailyRuleComment(record, dailyText) {
    const name = record.info.name;
    if (!dailyText || dailyText.trim() === "") {
        return `${name} 同学在校表现中规中矩，遵守纪律，尊敬师长，与同学相处融洽。希望今后能更加积极主动地参与班级活动。`;
    }

    let text = `${name} 同学在校期间表现`;

    // 简单的关键词匹配逻辑
    if (dailyText.includes("积极") || dailyText.includes("优") || dailyText.includes("强")) {
        text += `非常积极。`;
    } else if (dailyText.includes("差") || dailyText.includes("拖拉")) {
        text += `有待加强。`;
    } else {
        text += `良好。`;
    }

    // 将输入的关键词串联起来
    text += ` 老师注意到你：${dailyText}。`;

    // 根据关键词给建议
    if (dailyText.includes("走神") || dailyText.includes("讲话")) {
        text += ` 希望你能改掉上课注意力不集中的小毛病，提高课堂效率。`;
    } else if (dailyText.includes("内向") || dailyText.includes("自信")) {
        text += ` 希望你今后能更加自信，多与老师同学交流，展现更棒的自己。`;
    } else if (dailyText.includes("助人") || dailyText.includes("劳动")) {
        text += ` 这种乐于奉献的精神值得所有同学学习，你是老师得力的小助手。`;
    } else {
        text += ` 希望你继续保持优点，改掉不足，做更好的自己。`;
    }

    return text;
}

/**
 * 4. [综合] 历史趋势 + 日常表现 (各取一半)
 */
function generateComprehensiveRuleComment(record, dailyText) {
    // 1. 获取成绩部分
    const exams = record.exams;
    let scorePart = "";
    if (exams && exams.length >= 2) {
        const first = exams[0].gradeRank || exams[0].rank;
        const last = exams[exams.length - 1].gradeRank || exams[exams.length - 1].rank;
        const diff = first - last;
        if (diff > 0) scorePart = `本学期成绩稳步提升，排名进步了 ${diff} 名，这与你的努力分不开。`;
        else if (diff < 0) scorePart = `本学期成绩略有起伏，排名有所下滑，需要反思学习方法。`;
        else scorePart = `本学期成绩保持稳定，基础较为扎实。`;
    } else {
        scorePart = `本学期学习态度端正，能按时完成学习任务。`;
    }

    // 2. 获取日常部分
    let dailyPart = "";
    if (dailyText) {
        dailyPart = `在生活中，你${dailyText}。`;
    } else {
        dailyPart = `在生活中，你尊敬师长，团结同学，遵守校纪校规。`;
    }

    // 3. 拼接
    return `${record.info.name} 同学：${scorePart}${dailyPart} 希望你在  的学期里，能够发扬优点，弥补不足，向着更高的目标迈进！`;
}


/**
 * [数学核心] 计算线性回归斜率 (Linear Regression Slope)
 * 用于评估成绩的平均走势
 * @param {Array} values - 排名数组 (y轴)
 * @returns {Number} - 斜率 (Slope)。负数代表数值变小(排名进步)，正数代表数值变大(退步)
 */
function calculateTrendSlope(values) {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0;   // 考试次序之和 (0+1+2...)
    let sumY = 0;   // 排名之和
    let sumXY = 0;  // 次序*排名 之和
    let sumXX = 0;  // 次序平方 之和

    for (let i = 0; i < n; i++) {
        const x = i;        // x轴：时间/次序
        const y = values[i]; // y轴：排名

        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    // 斜率公式: (nΣxy - ΣxΣy) / (nΣx² - (Σx)²)
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
}



// =====================================================================
//    NEW    模块十八：个性化错题/薄弱点“攻坚本”生成器
// =====================================================================

/**
 * 18.1 渲染主界面 (已升级：批量 AI 生成)
 */
function renderWeaknessWorkbook(container) {
    // 1. 检查数据源
    if (!G_ItemAnalysisData || Object.keys(G_ItemAnalysisData).length === 0) {
        container.innerHTML = `<div class="main-card-wrapper" style="text-align:center; padding:50px; color:#666;">⚠️ 请先前往“学科小题分析”导入数据。</div>`;
        return;
    }

    const subjects = Object.keys(G_ItemAnalysisData);

    container.innerHTML = `
        <h2>📝 模块十八：个性化错题攻坚本生成器</h2>
        <p style="color: var(--text-muted); margin-top:-10px;">
            自动筛选学生的薄弱题目，支持 AI 批量生成同类变式题，一键打印专属订正单。
        </p>
        <p style="color: var(--text-muted); margin-top:-10px;">
            题目为Ai 生成，请仔细甄别是否有错误！！！
        </p>

        <div class="main-card-wrapper" style="border-left: 5px solid #fd7e14;">
            <h4 style="margin-top:0;">🛠️ 生成配置</h4>
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; flex-wrap: wrap;">
                
                <label>选择科目:</label>
                <select id="wb-subject-select" class="sidebar-select" style="width:auto; min-width:120px;">
                    ${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>

                <label style="margin-left:15px;">选择班级:</label>
                <select id="wb-class-select" class="sidebar-select" style="width:auto; min-width:120px;">
                    <option value="ALL">-- 全体 --</option>
                </select>

                <label style="margin-left:15px;">薄弱阈值:</label>
                <select id="wb-threshold" class="sidebar-select" style="width:auto;">
                    <option value="0.6" selected>得分率 < 60% (不及格)</option>
                    <option value="0.8">得分率 < 80% (非优秀)</option>
                    <option value="1.0">所有错题 (得分 < 满分)</option>
                </select>

                <button id="btn-gen-workbook" class="sidebar-button" style="background-color: #fd7e14; margin-left: 15px;">
                    📄 生成预览列表
                </button>
                
                <button id="btn-batch-ai-workbook" class="sidebar-button" style="background-color: #6f42c1; margin-left: 10px; display:none;">
                    🤖 批量生成变式题
                </button>

                <button id="btn-print-workbook" class="sidebar-button" style="background-color: var(--color-blue); margin-left: 10px; display:none;">
                    🖨️ 批量打印攻坚本
                </button>
            </div>
            
            <div id="wb-batch-progress" style="display:none; margin-top:15px; background:#f8f9fa; padding:10px; border-radius:6px; border:1px solid #eee;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.9em; margin-bottom:5px;">
                    <span id="wb-progress-text" style="font-weight:bold; color:#555;">AI 生成中... (0/0)</span>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <button id="btn-stop-wb-ai" style="border:none; background:none; color:#dc3545; cursor:pointer; font-weight:bold;">⏹ 停止</button>
                        <button id="btn-close-wb-progress" style="border:none; background:none; color:#999; cursor:pointer; font-size:1.2em; line-height:1;">&times;</button>
                    </div>
                </div>
                <div style="width:100%; background:#e9ecef; height:8px; border-radius:4px; overflow:hidden;">
                    <div id="wb-progress-bar" style="width:0%; height:100%; background:#6f42c1; transition:width 0.3s;"></div>
                </div>
            </div>
        </div>

        <div id="wb-preview-area" class="main-card-wrapper" style="display:none;">
            <div style="margin-bottom:10px; font-weight:bold; color:#555;">
                共筛选出 <span id="wb-student-count" style="color:#fd7e14;">0</span> 名学生有薄弱题，
                累计 <span id="wb-question-total" style="color:#fd7e14;">0</span> 道错题。
            </div>
            <div class="table-container" style="max-height: 600px; overflow-y: auto;">
                <table id="wb-preview-table">
                    <thead>
                        <tr>
                            <th style="width:80px;">姓名</th>
                            <th style="width:80px;">薄弱题数</th>
                            <th>薄弱题目详情 (题号 / 知识点 / 得分率)</th>
                            <th style="width:100px;">AI 状态</th>
                            <th style="width:120px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="wb-preview-tbody"></tbody>
                </table>
            </div>
        </div>
    `;

    // 2. 绑定基础事件
    const subjectSelect = document.getElementById('wb-subject-select');
    const classSelect = document.getElementById('wb-class-select');

    const updateClassList = () => {
        const sub = subjectSelect.value;
        if (!sub || !G_ItemAnalysisData[sub]) return;
        const students = G_ItemAnalysisData[sub].students;
        const classes = [...new Set(students.map(s => s.class))].sort();
        classSelect.innerHTML = `<option value="ALL">-- 全体 --</option>` + classes.map(c => `<option value="${c}">${c}</option>`).join('');
    };
    subjectSelect.addEventListener('change', updateClassList);
    updateClassList();

    let workbookData = []; // 数据缓存

    document.getElementById('btn-gen-workbook').addEventListener('click', () => {
        const subject = subjectSelect.value;
        const className = classSelect.value;
        const threshold = parseFloat(document.getElementById('wb-threshold').value);
        workbookData = calculateWeaknessWorkbook(subject, className, threshold);
        renderWorkbookPreview(workbookData); // 这里会控制按钮显示
    });

    document.getElementById('btn-print-workbook').addEventListener('click', () => {
        if (workbookData.length === 0) return;
        const subject = subjectSelect.value;
        if (workbookData.length > 20 && !confirm(`即将生成 ${workbookData.length} 份攻坚本，是否继续？`)) return;
        printWorkbook(workbookData, subject);
    });

    // ============================================================
    //    NEW    批量 AI 生成逻辑
    // ============================================================
    let wbAiController = null;

    document.getElementById('btn-batch-ai-workbook').addEventListener('click', async () => {
        const apiKey = localStorage.getItem('G_DeepSeekKey');
        if (!apiKey) { alert("请先在【AI 智能分析】模块设置 API Key！"); return; }

        // 筛选出还没生成的学生
        const pendingItems = workbookData.map((item, index) => ({ item, index })).filter(obj => !obj.item.aiExercises);

        if (pendingItems.length === 0) {
            alert("当前列表中所有学生均已生成变式题，无需重复生成。");
            return;
        }

        if (!confirm(`即将为 ${pendingItems.length} 位学生批量生成变式题。\n这需要消耗 Token 并花费一定时间。\n\n确定开始吗？`)) return;

        // UI 初始化
        const progressBox = document.getElementById('wb-batch-progress');
        const progressBar = document.getElementById('wb-progress-bar');
        const progressText = document.getElementById('wb-progress-text');
        progressBox.style.display = 'block';

        if (wbAiController) wbAiController.abort();
        wbAiController = new AbortController();

        let completed = 0;
        const subject = subjectSelect.value;

        for (const obj of pendingItems) {
            if (wbAiController.signal.aborted) break;

            const { item, index } = obj;
            const studentName = item.student.name;

            // 提取知识点
            const kps = [...new Set(item.questions.map(q => q.kp).filter(k => k && k !== '未标记'))];

            if (kps.length === 0) {
                completed++; // 没知识点跳过，也算进度
                continue;
            }

            progressText.innerText = `🤖 正在出题: ${studentName} (${completed + 1}/${pendingItems.length})`;

            // 视觉上定位到该行 (可选)
            const row = document.getElementById(`wb-row-${index}`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });

            try {
                const exercises = await fetchAIExercises(apiKey, studentName, kps, subject); // 复用之前的函数
                item.aiExercises = exercises; // 保存数据

                // 更  表格状态 UI
                if (row && row.cells[3]) {
                    row.cells[3].innerHTML = `<span style="color:#28a745; font-size:0.8em;">✅ 已生成</span>`;
                }

                completed++;
                progressBar.style.width = `${(completed / pendingItems.length) * 100}%`;

                // 延时防封
                await new Promise(r => setTimeout(r, 800));

            } catch (err) {
                if (row && row.cells[3]) row.cells[3].innerHTML = `<span style="color:red; font-size:0.8em;">❌ 失败</span>`;
            }
        }

        if (!wbAiController.signal.aborted) {
            progressText.innerText = "✅ 批量任务完成！";
            setTimeout(() => { progressBox.style.display = 'none'; }, 3000);
        }
    });

    // 停止与关闭
    document.getElementById('btn-stop-wb-ai').addEventListener('click', () => {
        if (wbAiController) {
            wbAiController.abort();
            document.getElementById('wb-progress-text').innerText = "🛑 已停止";
        }
    });
    document.getElementById('btn-close-wb-progress').addEventListener('click', () => {
        if (wbAiController) wbAiController.abort();
        document.getElementById('wb-batch-progress').style.display = 'none';
    });
}

/**
 * 18.2 计算逻辑：筛选薄弱题
 */
function calculateWeaknessWorkbook(subject, className, threshold) {
    const itemData = G_ItemAnalysisData[subject];
    const itemConfig = G_ItemAnalysisConfig[subject] || {};
    const recalculatedStats = getRecalculatedItemStats(subject); // 复用模块13的计算逻辑

    let students = itemData.students;
    if (className !== 'ALL') {
        students = students.filter(s => s.class === className);
    }

    const result = [];

    students.forEach(student => {
        const weakQuestions = [];

        // 遍历小题
        (recalculatedStats.minorQuestions || []).forEach(qName => {
            checkQuestion(student, qName, 'minorScores', recalculatedStats.minorStats, itemConfig, threshold, weakQuestions);
        });

        // 遍历大题
        (recalculatedStats.majorQuestions || []).forEach(qName => {
            checkQuestion(student, qName, 'majorScores', recalculatedStats.majorStats, itemConfig, threshold, weakQuestions);
        });

        if (weakQuestions.length > 0) {
            result.push({
                student: student,
                questions: weakQuestions
            });
        }
    });

    return result;
}

// 辅助：检查单题是否薄弱
function checkQuestion(student, qName, scoreType, statsObj, configObj, threshold, targetArray) {
    const score = student[scoreType][qName];
    const stat = statsObj[qName];
    const config = configObj[qName] || {};

    // 获取正确满分
    const fullScore = config.fullScore || stat.maxScore;
    const kp = config.content || ""; // 知识点

    if (typeof score === 'number' && !isNaN(score) && fullScore > 0) {
        const rate = score / fullScore;

        // 判断是否低于阈值
        // 特殊处理：如果 threshold是1.0，只要 score < fullScore 就算错题
        let isWeak = false;
        if (threshold >= 0.99) {
            isWeak = score < fullScore;
        } else {
            isWeak = rate < threshold;
        }

        if (isWeak) {
            targetArray.push({
                qName: qName,
                kp: kp,
                score: score,
                full: fullScore,
                rate: rate
            });
        }
    }
}

/**
 * 18.3 渲染预览表格 (已升级：关联批量按钮)
 */
function renderWorkbookPreview(data) {
    const container = document.getElementById('wb-preview-area');
    const tbody = document.getElementById('wb-preview-tbody');
    const printBtn = document.getElementById('btn-print-workbook');
    const batchAiBtn = document.getElementById('btn-batch-ai-workbook'); //   
    const countEl = document.getElementById('wb-student-count');
    const totalEl = document.getElementById('wb-question-total');

    container.style.display = 'block';

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">当前条件下没有学生需要生成攻坚本。</td></tr>`;
        printBtn.style.display = 'none';
        batchAiBtn.style.display = 'none'; // Hide
        return;
    }

    printBtn.style.display = 'inline-block';
    batchAiBtn.style.display = 'inline-block'; // Show

    let totalQ = 0;
    data.forEach(d => totalQ += d.questions.length);

    countEl.innerText = data.length;
    totalEl.innerText = totalQ;

    tbody.innerHTML = data.map((item, index) => {
        // 预览前5题
        const previewQ = item.questions.slice(0, 5).map(q =>
            `<span style="display:inline-block; background:#fff3cd; padding:2px 6px; border-radius:4px; margin:2px; font-size:0.85em; border:1px solid #ffeeba;">
                题${q.qName} [${(q.rate * 100).toFixed(0)}%] ${q.kp ? '(' + q.kp + ')' : ''}
            </span>`
        ).join('');
        const more = item.questions.length > 5 ? `...等${item.questions.length}题` : '';

        // 状态检查
        const aiStatus = item.aiExercises ? `<span style="color:#28a745; font-size:0.8em;">✅ 已生成</span>` : `<span style="color:#ccc; font-size:0.8em;">未生成</span>`;

        return `
            <tr id="wb-row-${index}">
                <td style="font-weight:bold;">${item.student.name}</td>
                <td style="text-align:center;">${item.questions.length}</td>
                <td>${previewQ} ${more}</td>
                <td style="text-align:center;">${aiStatus}</td>
                <td>
                    <div style="display:flex; gap:5px;">
                        <button class="sidebar-button" style="font-size:0.8em; padding:4px 8px; background-color:#6f42c1;" onclick="generateSingleAIExercises(${index}, this)">🤖 单独生成</button>
                        <button class="sidebar-button" style="font-size:0.8em; padding:4px 8px;" onclick="printSingleWorkbook(${index})">🖨️ 打印</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // 挂载全局函数
    window.printSingleWorkbook = (index) => {
        const subject = document.getElementById('wb-subject-select').value;
        printWorkbook([data[index]], subject);
    };

    //            挂载 AI 生成函数
    window.generateSingleAIExercises = async (index, btnElement) => {
        const apiKey = localStorage.getItem('G_DeepSeekKey');
        if (!apiKey) { alert("请先在【AI 智能分析】模块设置 API Key！"); return; }

        const item = data[index];
        // 提取知识点列表 (去重)
        const kps = [...new Set(item.questions.map(q => q.kp).filter(k => k && k !== '未标记'))];

        if (kps.length === 0) {
            alert("该学生的错题未配置具体“知识点”，AI 无法针对性出题。\n请先去“学科小题分析”模块点击“配置题目”完善考察内容。");
            return;
        }

        const originalText = btnElement.innerText;
        btnElement.innerText = "⏳ 生成中...";
        btnElement.disabled = true;

        try {
            // 调用 AI
            const exercises = await fetchAIExercises(apiKey, item.student.name, kps, document.getElementById('wb-subject-select').value);

            // 保存结果到数据对象中
            item.aiExercises = exercises; // 这是一个包含题目文本的字符串

            btnElement.innerText = "✅ 完成";
            // 刷  该行状态 (可选)
            const row = document.getElementById(`wb-row-${index}`);
            if (row && row.cells[3]) row.cells[3].innerHTML = `<span style="color:#28a745; font-size:0.8em;">✅ 已生成</span>`;

        } catch (err) {
            alert("生成失败: " + err.message);
            btnElement.innerText = originalText;
            btnElement.disabled = false;
        }
    };
}

/**
 * 18.5    请求 AI 生成变式题
 */
async function fetchAIExercises(apiKey, studentName, kps, subject) {
    // 限制一下知识点数量
    const targetKps = kps.slice(0, 5).join('、');

    const prompt = `
你是一位资深的${subject}老师。学生【${studentName}】在以下知识点掌握薄弱：【${targetKps}】。

请为他设计一套“针对性攻坚练习题”：
1. 针对上述每个知识点，出一道同等难度的变式题。
2. 生成所有的题目后,再在最后一题的后面附带【答案】和简短【解析】。
3. 格式与公式要求（非常重要）：
   - 所有数学、物理、化学符号、公式、单位，请务必使用 LaTeX 格式。
   - 行内公式用单美元符号包裹，例如：$f(x) = x^2$。
   - 独立公式用双美元符号包裹，例如：$$ E = mc^2 $$。
   - 化学式也请用 LaTeX，例如：$\\text{H}_2\\text{O}$ 或 $\\text{Fe}^{2+}$。
4. 排版要求：
   - 题号使用 (1), (2)...
   - 答案和解析写在最后。
   - 不要写前言后语，直接出题。
   - 总字数控制在 800 字以内。
    `.trim();

    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: 'deepseek-chat', // 使用 V3 即可
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        })
    });

    if (!response.ok) throw new Error("API 请求失败");
    const data = await response.json();
    return data.choices[0].message.content.trim();
}

/**
 * 18.4 核心打印逻辑 (最终修复版：包含考试名称 + AI公式渲染)
 */
async function printWorkbook(dataList, subjectName) {
    //            获取考试名称
    let examName = await localforage.getItem('G_ItemAnalysisFileName');
    if (!examName) {
        // 如果小题文件名不存在，尝试获取主文件名
        examName = await localforage.getItem('G_MainFileName') || "本次考试";
    }
    // 去除文件后缀 (.xlsx, .csv 等)
    examName = examName.replace(/\.(xlsx|xls|csv)$/i, '');

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${examName} - ${subjectName} 攻坚本</title>
        <meta charset="UTF-8">
        
        <link rel="stylesheet" href="https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.css">
        <script src="https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js"><\/script>
        <script src="https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"><\/script>
        
        <style>
            body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; padding: 0; margin: 0; color: #333; }
            .page { 
                width: 210mm; min-height: 297mm; 
                padding: 1.5cm; box-sizing: border-box; 
                margin: 0 auto; background: white;
                page-break-after: always;
                position: relative;
                display: flex;
                flex-direction: column;
            }
            .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; flex-shrink: 0; }
            /* [修改] 标题样式微调 */
            .header h1 { margin: 0 0 8px 0; font-size: 24px; line-height: 1.4; }
            .header p { margin: 0; color: #666; font-size: 14px; }
            
            .content-wrapper { display: flex; flex-grow: 1; gap: 20px; }
            
            .left-column { width: 40%; border-right: 1px dashed #ccc; padding-right: 15px; }
            .q-item { margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #eee; break-inside: avoid; }
            .q-num { font-size: 1.1em; font-weight: bold; color: #000; }
            .q-kp { font-size: 0.9em; color: #666; margin-top: 2px; }
            .q-score { font-size: 0.9em; color: #dc3545; font-weight:bold; margin-top: 2px; }
            
            .right-column { width: 60%; position: relative; }
            .workspace-title { 
                font-weight: bold; color: #e0e0e0; font-size: 1.5em; 
                text-align: center; margin-bottom: 20px; border-bottom: 2px solid #f0f0f0;
            }
            .ai-content { 
                font-size: 14px; line-height: 1.6; color: #333; 
                white-space: pre-wrap; text-align: justify;
            }
            .katex { font-size: 1.1em; } 
            
            @media print {
                body { background: none; }
                .page { margin: 0; border: none; width: auto; height: auto; }
                .header { -webkit-print-color-adjust: exact; }
            }
        </style>
    </head>
    <body>
    `;

    dataList.forEach(d => {
        let rightContent = '';
        if (d.aiExercises) {
            rightContent = `
                <div class="workspace-title" style="color:#6f42c1;">🤖 AI 智能变式训练</div>
                <div class="ai-content">${d.aiExercises}</div>
            `;
        } else {
            rightContent = `
                <div class="workspace-title">✍️ 错题订正 / 归因分析</div>
                <div style="height: 100%; background-image: linear-gradient(#f5f5f5 1px, transparent 1px); background-size: 100% 2em;"></div>
            `;
        }

        let leftContent = '';
        d.questions.forEach(q => {
            leftContent += `
                <div class="q-item">
                    <div class="q-num">第 ${q.qName} 题</div>
                    <div class="q-kp">📌 考点：${q.kp || '未标记'}</div>
                    <div class="q-score">得分：${q.score} / ${q.full} <span style="color:#999; font-weight:normal; font-size:0.9em;">(率 ${(q.rate * 100).toFixed(0)}%)</span></div>
                </div>
            `;
        });

        //    修改    在 header 中插入 examName
        html += `
        <div class="page">
            <div class="header">
                <h1>${examName} · ${subjectName}</h1>
                <h1>个性化攻坚本</h1>
                <p>姓名：<strong>${d.student.name}</strong> | 班级：${d.student.class} | 待攻坚题数：${d.questions.length}</p>
            </div>
            
            <div class="content-wrapper">
                <div class="left-column">
                    <div style="margin-bottom:10px; font-weight:bold; color:#555;">🚫 我的薄弱点：</div>
                    ${leftContent}
                </div>
                <div class="right-column">
                    ${rightContent}
                </div>
            </div>
        </div>
        `;
    });

    html += `
        <script>
            window.onload = function() {
                const renderOptions = {
                    delimiters: [
                        {left: "$$", right: "$$", display: true},
                        {left: "$", right: "$", display: false},
                        {left: "\\\\(", right: "\\\\)", display: false},
                        {left: "\\\\[", right: "\\\\]", display: true}
                    ],
                    throwOnError: false
                };
                if (window.renderMathInElement) {
                    renderMathInElement(document.body, renderOptions);
                }
                setTimeout(function() {
                    window.focus();
                    window.print();
                }, 500);
            };
        <\/script>
    </body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}


/**
 * [旗舰完整版] 24.1 渲染主界面
 * 集成双模式：
 * Tab 1: 快捷喜报 (自动挖掘 + 长图生成)
 * Tab 2: 专业奖状 (自定义排版 + 高清打印)
 */
function renderHonorWall(container) {
    // --- [Tab 1 数据准备] ---
    const classes = [...new Set(G_StudentsData.map(s => s.class))].sort();
    const classOptions = classes.map(c => `<option value="${c}">${c}</option>`).join('');
    
    // 获取默认文件名用于标题占位
    let defaultName = localStorage.getItem('G_MainFileName') || "本次考试";
    defaultName = defaultName.replace(/\.(xlsx|xls|csv)/i, '');

    // --- [渲染 HTML 结构] ---
    container.innerHTML = `
        <h2>🏆 模块十九：荣誉中心</h2>
        
        <div class="tab-header" style="display:flex; border-bottom:2px solid #ddd; margin-bottom:20px;">
            <div class="tab-item active" data-tab="quick-poster" style="padding:10px 20px; cursor:pointer; font-weight:bold; color:#d35400; border-bottom:3px solid #d35400;">🚀 快捷喜报生成</div>
            <div class="tab-item" data-tab="custom-cert" style="padding:10px 20px; cursor:pointer; color:#666;">🎨 专业奖状定制</div>
        </div>

        <div id="tab-content-quick-poster" class="tab-content">
            
            <div class="main-card-wrapper" style="border-left: 5px solid #6f42c1; background: #f8f9fa; margin-bottom: 20px;">
                <h4 style="margin:0 0 15px 0; color:#6f42c1;">⚙️ 喜报外观配置</h4>
                <div style="display:flex; gap:30px; align-items:flex-start; flex-wrap:wrap;">
                    
                    <div style="flex:1; min-width:250px;">
                        <label style="font-weight:bold; display:block; margin-bottom:8px; color:#555;">1. 顶部小标题 (自定义考试名):</label>
                        <input type="text" id="honor-custom-title" class="sidebar-select" style="width:100%;" placeholder="默认显示：${defaultName}" value="${localStorage.getItem('G_Honor_CustomTitle') || ''}">
                        <p style="font-size:0.8em; color:#999; margin-top:5px;">* 修改后将永久保存，直到下次修改。</p>
                    </div>
                    
                    <div style="flex:1; min-width:250px;">
                        <label style="font-weight:bold; display:block; margin-bottom:8px; color:#555;">2. 学校/班级 Logo:</label>
                        <div style="display:flex; align-items:center; gap:15px;">
                            <div id="honor-logo-preview-box" style="width:60px; height:60px; border:2px dashed #ccc; border-radius:8px; display:flex; justify-content:center; align-items:center; background:white; overflow:hidden;">
                                <span style="font-size:0.8em; color:#ccc;">无</span>
                            </div>
                            
                            <div style="display:flex; flex-direction:column; gap:5px;">
                                <label for="honor-logo-upload" class="sidebar-button" style="background-color:#fff; color:#333; border:1px solid #ccc; cursor:pointer; font-size:0.9em; text-align:center;">
                                    📤 上传图片
                                </label>
                                <input type="file" id="honor-logo-upload" accept="image/*" style="display:none;">
                                
                                <button id="btn-clear-logo" class="sidebar-button" style="background-color:#dc3545; font-size:0.8em; padding:4px 10px; display:none;">🗑️ 删除</button>
                            </div>
                        </div>
                        <p style="font-size:0.8em; color:#999; margin-top:5px;">* 图片将保存在浏览器中，下次无需重新上传。</p>
                    </div>
                </div>
            </div>

            <div class="main-card-wrapper" style="border-left: 5px solid #ffc107; background: #fffdf5;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 15px;">
                    <div>
                        <h4 style="margin:0; color:#d35400;">🌟 荣誉挖掘机</h4>
                        <p style="font-size:0.8em; color:#888; margin:5px 0 0 0;">基于【本次成绩】与【对比成绩】自动计算。</p>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label style="font-weight:bold; color:#555;">统计范围:</label>
                        <select id="honor-class-filter" class="sidebar-select" style="width:auto; min-width:120px; font-weight:bold; border-color:#ffc107;">
                            <option value="ALL">🏫 全体年段</option>
                            ${classOptions}
                        </select>
                        <button id="btn-honor-refresh" class="sidebar-button" style="background-color:#ffc107; color:#333;">🔄 刷新数据</button>
                    </div>
                </div>
            </div>

            <div id="honor-display-area" style="margin-top:20px;"></div>

            <div id="poster-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="max-width: 500px; max-height: 90vh; display: flex; flex-direction: column; background: #f5f5f5; padding: 0;">
                    <div class="modal-header" style="padding: 15px; flex-shrink: 0;">
                        <h3>🖼️ 喜报预览</h3>
                        <span onclick="document.getElementById('poster-modal').style.display='none'" class="modal-close-btn">&times;</span>
                    </div>
                    <div class="modal-body" style="padding: 0; flex-grow: 1; overflow-y: auto; display: flex; justify-content: center; background: #333;">
                        <div id="poster-canvas-container" style="margin: 20px 0;"></div>
                    </div>
                    <div class="modal-footer" style="justify-content: center; gap: 15px; flex-shrink: 0; padding: 15px;">
                        <p style="font-size:0.85em; color:#666; width:100%; margin-bottom:10px; text-align:center;">(长按上方图片或点击下载按钮保存)</p>
                        <button id="btn-download-poster" class="sidebar-button" style="background-color: #d35400;">📥 下载图片</button>
                    </div>
                </div>
            </div>
        </div>

        <div id="tab-content-custom-cert" class="tab-content" style="display:none;">
            <div id="cert-creator-container"></div>
        </div>
    `;

    // ==============================================
    // 1. Tab 切换逻辑
    // ==============================================
    const tabs = container.querySelectorAll('.tab-item');
    const contents = container.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => { t.classList.remove('active'); t.style.color='#666'; t.style.borderBottom='none'; });
            contents.forEach(c => c.style.display = 'none');
            
            tab.classList.add('active');
            tab.style.color='#d35400';
            tab.style.borderBottom='3px solid #d35400';
            container.querySelector(`#tab-content-${tab.dataset.tab}`).style.display = 'block';
        });
    });

    // ==============================================
    // 2. Tab 1 (快捷喜报) 事件绑定
    // ==============================================
    
    // A. 标题输入保存
    const titleInput = document.getElementById('honor-custom-title');
    if (titleInput) {
        titleInput.addEventListener('input', (e) => {
            localStorage.setItem('G_Honor_CustomTitle', e.target.value);
        });
    }

    // B. Logo 处理逻辑
    const logoInput = document.getElementById('honor-logo-upload');
    const logoPreviewBox = document.getElementById('honor-logo-preview-box');
    const clearLogoBtn = document.getElementById('btn-clear-logo');

    const updateLogoPreview = async () => {
        const base64 = await localforage.getItem('G_School_Logo');
        if (base64 && logoPreviewBox) {
            logoPreviewBox.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:contain;">`;
            if(clearLogoBtn) clearLogoBtn.style.display = 'inline-block';
        } else if (logoPreviewBox) {
            logoPreviewBox.innerHTML = `<span style="font-size:0.8em; color:#ccc;">无</span>`;
            if(clearLogoBtn) clearLogoBtn.style.display = 'none';
        }
    };
    updateLogoPreview(); // 初始加载

    if (logoInput) {
        logoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                await localforage.setItem('G_School_Logo', event.target.result);
                updateLogoPreview();
            };
            reader.readAsDataURL(file);
        });
    }

    if (clearLogoBtn) {
        clearLogoBtn.addEventListener('click', async () => {
            await localforage.removeItem('G_School_Logo');
            if(logoInput) logoInput.value = '';
            updateLogoPreview();
        });
    }

    // C. 刷新与筛选
    const refreshBtn = document.getElementById('btn-honor-refresh');
    const filterSelect = document.getElementById('honor-class-filter');
    
    if (refreshBtn) refreshBtn.onclick = () => calculateAndRenderHonors();
    if (filterSelect) filterSelect.addEventListener('change', () => calculateAndRenderHonors());

    // 初始加载 Tab 1 数据
    calculateAndRenderHonors();

    // ==============================================
    // 3. Tab 2 (专业奖状) 初始化
    // ==============================================
    const certContainer = document.getElementById('cert-creator-container');
    if (certContainer) {
        renderCertificateCreator(certContainer);
    }
}

/**
 * [旗舰版 V8] 24.2 计算荣誉名单
 * - 功能：自动挖掘荣誉学生、生成可视化卡片、生成奖状定制数据
 * - 亮点：支持“奖项行”独立拆分 (award)、文案智能适配班级/年级、数据实时联动
 */
function calculateAndRenderHonors() {
    const container = document.getElementById('honor-display-area');
    const filterVal = document.getElementById('honor-class-filter').value;

    // 1. 获取数据上下文 (支持班级筛选)
    let activeData = G_StudentsData;
    let compareData = G_CompareData;

    if (filterVal !== 'ALL') {
        activeData = G_StudentsData.filter(s => s.class === filterVal);
        if (G_CompareData) {
            compareData = G_CompareData.filter(s => s.class === filterVal);
        }
    }

    if (!activeData || activeData.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:#999;">该范围内暂无数据。</p>`;
        window.G_Honor_List = [];
        if (typeof window.updateCertChecklist === 'function') window.updateCertChecklist();
        return;
    }

    // 获取动态考试名称
    let examName = localStorage.getItem('G_Honor_CustomTitle');
    if (!examName) {
        examName = localStorage.getItem('G_MainFileName') || "本次考试";
        examName = examName.replace(/\.(xlsx|xls|csv)/i, '');
    }

    // =========================================
    //   核心计算逻辑
    // =========================================
    
    // 1. 🏆 巅峰领跑者 (总分 Top 5)
    const topTotal = [...activeData].sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);

    // 2. 🥇 单科状元 (各科 Top 1)
    const subjectKings = [];
    G_DynamicSubjectList.forEach(sub => {
        let maxScore = -Infinity;
        activeData.forEach(s => { if ((s.scores[sub]||0) > maxScore) maxScore = s.scores[sub]; });
        if (maxScore > 0) {
            const kings = activeData.filter(s => s.scores[sub] === maxScore);
            subjectKings.push({ subject: sub, score: maxScore, students: kings });
        }
    });

    // 3. 🚀 进步之星 (拆分：年级 vs 班级)
    let gradeProgressStars = [];
    let classProgressStars = [];
    
    if (compareData && compareData.length > 0) {
        // A. 年级进步榜 (对比 gradeRank)
        gradeProgressStars = activeData.map(s => {
            const old = compareData.find(o => String(o.id) === String(s.id));
            if (!old || !old.gradeRank || !s.gradeRank) return null;
            return { ...s, diff: old.gradeRank - s.gradeRank };
        }).filter(s => s && s.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);

        // B. 班级进步榜 (对比 rank)
        classProgressStars = activeData.map(s => {
            const old = compareData.find(o => String(o.id) === String(s.id));
            if (!old || !old.rank || !s.rank) return null;
            return { ...s, diff: old.rank - s.rank };
        }).filter(s => s && s.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
    }

    // 4. ⚖️ 全能战士 (均衡度 Top 5)
    const top30PercentCount = Math.ceil(activeData.length * 0.3);
    const highScorers = [...activeData].sort((a, b) => b.totalScore - a.totalScore).slice(0, top30PercentCount);
    const balancedStars = highScorers.map(s => {
        const rates = [];
        G_DynamicSubjectList.forEach(sub => {
            const config = G_SubjectConfigs[sub];
            if (config && config.full > 0 && typeof s.scores[sub] === 'number') {
                rates.push(s.scores[sub] / config.full);
            }
        });
        if (rates.length < 3) return null;
        const mean = rates.reduce((a, b) => a + b) / rates.length;
        const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rates.length;
        return { ...s, balanceScore: variance };
    }).filter(s => s !== null).sort((a, b) => a.balanceScore - b.balanceScore).slice(0, 5);


    // =========================================
    //   界面渲染 (HTML Card)
    // =========================================
    let html = ``;
    const createCard = (title, icon, color, contentHtml, type) => `
        <div class="main-card-wrapper" style="border-top: 4px solid ${color}; padding-top:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h4 style="margin:0; color:${color}; font-size:1.1em;">${icon} ${title}</h4>
                <button class="sidebar-button" style="background-color:${color}; font-size:0.85em; padding:4px 10px;" 
                    onclick="generatePoster('${type}', '${title.split(' ')[0]}')">
                    🖼️ 生成喜报
                </button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                ${contentHtml || '<span style="color:#999; font-size:0.9em;">(暂无数据)</span>'}
            </div>
        </div>
    `;

    // 1. 总分
    const topContent = topTotal.map((s, i) => `<div class="honor-badge" style="background:#fff8e1; border:1px solid #ffe082; color:#bf360c;"><span style="font-weight:bold;">Top${i+1} ${s.name}</span> <span style="font-size:0.8em;">(${s.totalScore})</span></div>`).join('');
    html += createCard('巅峰领跑榜 (Top5)', '🏆', '#f39c12', topContent, 'total');

    // 2. 单科
    const kingContent = subjectKings.map(k => {
        const names = k.students.map(s=>s.name).join('、');
        return `<div class="honor-badge" style="background:#e3f2fd; border:1px solid #90caf9; color:#0d47a1;"><span style="font-weight:bold;">${k.subject}：${names}</span> <span style="font-size:0.8em;">(${k.score})</span></div>`;
    }).join('');
    html += createCard('单科状元榜', '🥇', '#3498db', kingContent, 'subject');

    // 3. 进步 (年级)
    if (gradeProgressStars.length > 0) {
        const gradeContent = gradeProgressStars.map(s => `<div class="honor-badge" style="background:#e8f5e9; border:1px solid #a5d6a7; color:#1b5e20;"><span style="font-weight:bold;">${s.name}</span> <span style="font-size:0.8em;">(年排 ⬆️${s.diff})</span></div>`).join('');
        html += createCard('年级进步之星', '🚀', '#2ecc71', gradeContent, 'progress_grade');
    }

    // 4. 进步 (班级)
    if (classProgressStars.length > 0) {
        const classContent = classProgressStars.map(s => `<div class="honor-badge" style="background:#e0f7fa; border:1px solid #80deea; color:#006064;"><span style="font-weight:bold;">${s.name}</span> <span style="font-size:0.8em;">(班排 ⬆️${s.diff})</span></div>`).join('');
        html += createCard('班级进步之星', '📈', '#17a2b8', classContent, 'progress_class');
    }

    // 5. 均衡
    const balContent = balancedStars.map(s => `<div class="honor-badge" style="background:#f3e5f5; border:1px solid #ce93d8; color:#4a148c;"><span style="font-weight:bold;">${s.name}</span> <span style="font-size:0.8em;">(${s.totalScore})</span></div>`).join('');
    html += createCard('全能战士榜 (均衡)', '⚖️', '#9b59b6', balContent, 'balance');

    container.innerHTML = html + `<style>.honor-badge { padding: 6px 10px; border-radius: 4px; display:flex; align-items:center; gap:5px; font-size:0.9em; }</style>`;


    // =========================================
    // 🔥🔥🔥 数据导出 (含独立 award) 🔥🔥🔥
    // =========================================
    window.G_Honor_List = [];
    
    // 1. 巅峰领跑
    topTotal.forEach((s, i) => {
        let rankText = filterVal === 'ALL' ? `年级第 ${i+1} 名` : `班级第 ${i+1} 名 (年级第 ${s.gradeRank} 名)`;
        window.G_Honor_List.push({ 
            name: s.name, 
            title: "巅峰领跑奖", 
            desc: `在${examName}中以总分 ${s.totalScore} 分荣获${rankText}。`,
            award: `特被评为：<span class="cert-highlight">巅峰领跑者</span>`
        });
    });

    // 2. 单科状元
    subjectKings.forEach(k => {
        k.students.forEach(s => {
            window.G_Honor_List.push({ 
                name: s.name, 
                title: `${k.subject}单科状元`, 
                desc: `在${examName}中${k.subject}学科取得 ${k.score} 分的优异成绩。`,
                award: `特被评为：<span class="cert-highlight">${k.subject}单科状元</span>`
            });
        });
    });

    // 3.1 年级进步
    gradeProgressStars.forEach(s => {
        window.G_Honor_List.push({ 
            name: s.name, 
            title: "年级进步之星", 
            desc: `在${examName}中年级排名显著提升 ${s.diff} 名，勤奋刻苦。`,
            award: `特被评为：<span class="cert-highlight">年级进步之星</span>`
        });
    });

    // 3.2 班级进步
    classProgressStars.forEach(s => {
        window.G_Honor_List.push({ 
            name: s.name, 
            title: "班级进步之星", 
            desc: `在${examName}中班级排名显著提升 ${s.diff} 名，超越自我。`,
            award: `特被评为：<span class="cert-highlight">班级进步之星</span>`
        });
    });

    // 4. 全能战士
    balancedStars.forEach(s => {
        window.G_Honor_List.push({ 
            name: s.name, 
            title: "全能战士奖", 
            desc: `在${examName}中各科发展均衡，基础扎实。`,
            award: `特被评为：<span class="cert-highlight">全能战士</span>`
        });
    });

    // 🔥 强制刷新列表 UI
    if (typeof window.updateCertChecklist === 'function') {
        window.updateCertChecklist();
        
        // 同步更新批量按钮的数字 (可选)
        const btn = document.getElementById('btn-batch-generate-certs');
        if(btn) btn.innerText = `📦 生成 ZIP 压缩包 (${window.G_Honor_List.length})`;
    }
}

/**
 * [旗舰版] 24.3 生成喜报图片 (支持 Logo + 自定义标题 + 长图)
 */
window.generatePoster = async function(type, titleStr) {
    const modal = document.getElementById('poster-modal');
    const container = document.getElementById('poster-canvas-container');
    const downloadBtn = document.getElementById('btn-download-poster');
    
    // 1. 获取数据上下文
    const filterVal = document.getElementById('honor-class-filter').value;
    let scopeText = filterVal === 'ALL' ? "全体年段" : filterVal;
    
    let activeData = G_StudentsData;
    let compareData = G_CompareData;
    if (filterVal !== 'ALL') {
        activeData = G_StudentsData.filter(s => s.class === filterVal);
        if (G_CompareData) compareData = G_CompareData.filter(s => s.class === filterVal);
    }

    if (activeData.length === 0) { alert("当前范围内无数据，无法生成。"); return; }

    container.innerHTML = '<div style="padding:40px; color:white;">⏳ 正在绘制高清喜报...</div>';
    modal.style.display = 'flex';
    downloadBtn.style.display = 'none';

    // 2. 获取配置 (标题 & Logo)
    let customTitle = document.getElementById('honor-custom-title').value.trim();
    let examName = customTitle;
    
    if (!examName) {
        // 回退到默认文件名
        examName = localStorage.getItem('G_MainFileName') || "本次考试";
        examName = examName.replace(/\.(xlsx|xls|csv)/i, '');
    }

    // 异步获取 Logo
    const logoBase64 = await localforage.getItem('G_School_Logo');
    let logoHtml = '';
    if (logoBase64) {
        logoHtml = `<img src="${logoBase64}" style="height:60px; max-width:80%; object-fit:contain; margin-bottom:10px; border-radius:4px; background:rgba(255,255,255,0.9); padding:4px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">`;
    }

    // 3. 准备列表内容
    let listHtml = "";
    let mainColor = "#d35400";
    let subTitle = `范围：${scopeText}`;

    // --- 数据逻辑 (保持不变) ---
    if (type === 'total') {
        mainColor = "#c0392b"; titleStr = "巅峰领跑榜";
        const data = [...activeData].sort((a, b) => b.totalScore - a.totalScore).slice(0, 15);
        listHtml = data.map((s, i) => 
            `<div class="poster-row">
                <span class="poster-rank" style="background:${i<3?'#f1c40f':'#eee'}; color:${i<3?'#fff':'#666'}">${i+1}</span>
                <span class="poster-name">${s.name}</span>
                <span class="poster-score">${s.totalScore}分</span>
            </div>`
        ).join('');
    } 
else if (type === 'progress_grade') { // 年级进步
        mainColor = "#27ae60"; 
        titleStr = "年级进步之星";
        
        const data = activeData.filter(s => s.gradeRank!==undefined).map(s => {
             const old = (compareData||[]).find(o => String(o.id) === String(s.id));
             // 强制只算年排
             const diff = (old && old.gradeRank) ? (old.gradeRank - s.gradeRank) : 0;
             return { ...s, diff };
        }).filter(s => s.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 15);
        
        listHtml = data.map((s, i) => 
            `<div class="poster-row">
                <span class="poster-rank" style="background:#e8f5e9; color:#2e7d32;">${i+1}</span>
                <span class="poster-name">${s.name}</span>
                <span class="poster-detail" style="color:#e74c3c;">年排 ⬆️ ${s.diff}</span>
            </div>`
        ).join('');
    }
    else if (type === 'progress_class') { // 班级进步
        mainColor = "#17a2b8"; 
        titleStr = "班级进步之星";
        
        const data = activeData.filter(s => s.rank!==undefined).map(s => {
             const old = (compareData||[]).find(o => String(o.id) === String(s.id));
             // 强制只算班排
             const diff = (old && old.rank) ? (old.rank - s.rank) : 0;
             return { ...s, diff };
        }).filter(s => s.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 15);
        
        listHtml = data.map((s, i) => 
            `<div class="poster-row">
                <span class="poster-rank" style="background:#e0f7fa; color:#006064;">${i+1}</span>
                <span class="poster-name">${s.name}</span>
                <span class="poster-detail" style="color:#0097a7;">班排 ⬆️ ${s.diff}</span>
            </div>`
        ).join('');
    }
    else if (type === 'balance') {
        mainColor = "#8e44ad"; titleStr = "全能战士榜";
        const top30 = Math.ceil(activeData.length * 0.3);
        const pool = [...activeData].sort((a,b)=>b.totalScore-a.totalScore).slice(0, top30);
        const data = pool.map(s => {
             let arr = [];
             G_DynamicSubjectList.forEach(sub=> { 
                 const cfg = G_SubjectConfigs[sub];
                 if(typeof s.scores[sub]=='number' && cfg && cfg.full) arr.push(s.scores[sub]/cfg.full); 
             });
             if(arr.length===0) return {...s, v:999};
             const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
             const v = arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/arr.length;
             return {...s, v};
        }).sort((a,b)=>a.v - b.v).slice(0, 10);
        listHtml = data.map(s => 
            `<div class="poster-row">
                <span class="poster-icon">⚖️</span>
                <span class="poster-name">${s.name}</span>
                <span class="poster-detail">总分 ${s.totalScore}</span>
            </div>`
        ).join('');
    }
    else if (type === 'subject') {
        mainColor = "#2980b9"; titleStr = "单科状元榜";
        let rows = [];
        G_DynamicSubjectList.forEach(sub => {
            let max = -Infinity;
            activeData.forEach(s => { if(s.scores[sub] > max) max = s.scores[sub]; });
            if(max > 0) {
                const kings = activeData.filter(s => s.scores[sub] === max);
                const names = kings.map(k => k.name).join('、');
                rows.push({ sub, names: names, score: max });
            }
        });
        listHtml = rows.map(r => 
            `<div class="poster-row">
                <span class="poster-rank" style="background:${mainColor}; width:auto; padding:2px 8px; font-size:11px;">${r.sub}</span>
                <div style="flex-grow:1; margin-left:10px; text-align:left;">
                    <span class="poster-name" style="font-size:14px;">${r.names}</span>
                </div>
                <span class="poster-score" style="color:${mainColor}">${r.score}分</span>
            </div>`
        ).join('');
    }

    // 4. 构建 DOM
    const posterDom = document.createElement('div');
    posterDom.style.cssText = `
        width: 375px; min-height: 600px;
        background: linear-gradient(180deg, #fff5e6 0%, #ffffff 100%);
        padding: 0 0 30px 0;
        font-family: "Microsoft YaHei", sans-serif;
        box-sizing: border-box;
        position: absolute; top: -9999px; left: -9999px;
        box-shadow: 0 0 20px rgba(0,0,0,0.1);
    `;

    // 顶部背景色
    const headerBg = `background: ${mainColor};`; 
    
    posterDom.innerHTML = `
        <div style="${headerBg} padding: 25px 20px 20px 20px; text-align: center; color: white; border-radius: 0 0 20px 20px;">
            
            ${logoHtml}
            
            <div style="font-size:16px; opacity:0.95; margin-bottom:5px; font-weight:bold; line-height:1.4;">${examName}</div>
            
            <div style="font-size:32px; font-weight:bold; letter-spacing:2px; margin-top:5px;">${titleStr}</div>
            <div style="margin-top:10px; font-size:14px; background:rgba(255,255,255,0.2); display:inline-block; padding:4px 12px; border-radius:15px;">
                ${subTitle}
            </div>
        </div>
        
        <div style="padding: 20px;">
            <div style="background:white; border-radius:12px; padding:10px; box-shadow:0 5px 15px rgba(0,0,0,0.05);">
                ${listHtml}
            </div>
        </div>

        <div style="text-align:center; color:#bbb; font-size:12px;">
            - 智慧棱镜系统生成 -
        </div>

        <style>
            .poster-row { display:flex; justify-content:space-between; align-items:center; padding:12px 10px; border-bottom:1px dashed #eee; }
            .poster-row:last-child { border-bottom:none; }
            .poster-rank { width:24px; height:24px; line-height:24px; text-align:center; border-radius:50%; font-size:12px; font-weight:bold; flex-shrink:0; }
            .poster-name { font-weight:bold; font-size:15px; color:#333; margin-left:10px; flex-grow:1; text-align:left; line-height:1.4; }
            .poster-score { font-weight:bold; color:#333; font-size:16px; }
            .poster-detail { color:#666; font-size:13px; }
            .poster-icon { font-size:18px; }
        </style>
    `;

    document.body.appendChild(posterDom);

    // 5. 截图
    try {
        await new Promise(r => setTimeout(r, 200)); // 等待图片加载
        const canvas = await html2canvas(posterDom, {
            scale: 2, useCORS: true, backgroundColor: null
        });
        
        container.innerHTML = '';
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        canvas.style.borderRadius = '8px';
        canvas.style.display = 'block';
        container.appendChild(canvas);
        
        downloadBtn.style.display = 'inline-block';
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = `${titleStr}_${scopeText}_喜报.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        };
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="color:red;">生成失败：${err.message}</p>`;
    } finally {
        document.body.removeChild(posterDom);
    }
};

// =====================================================================
//    🏆 模块二十四：专业奖状定制 (终极完整版)
// =====================================================================

// 1. 全局状态对象 (带自动修复)
let G_CertState = {
    bgImage: null,
    bgRect: { x: 0, y: 0, w: 800, h: 565 },
    sealImage: null,
    seal: { x: 75, y: 75, w: 120, h: 200 }, // 统一使用 w, h
    
    texts: {
        title: 'HONORARY CERTIFICATE',
        winner: '张三峰 同学',
        desc: '在本次期末考试中成绩优异。',
        award: '特被评为：<span class="cert-highlight">学习标兵</span>', 
        footer: '特发此状，以资鼓励', 
        signature: '颁发单位', // 默认署名
        date: '二〇二五年十一月'
    },
    style: {
        fontFamily: '"KaiTi", "STKaiti", "楷体", serif', 
        color: '#333333',
        textAlign: 'center',
        sizes: { title: 30, winner: 30, desc: 20, award: 24, footer: 20, signature: 16, date: 16 }
    },
    paper: { size: 'A4', orientation: 'L' },
    layoutMode: 'auto', 
    manualPos: { 
        title: { x: 50, y: 28 }, 
        winner: { x: 20, y: 40 }, 
        desc: { x: 51, y: 49 }, 
        award: { x: 50, y: 55 },
        footer: { x: -23.0, y: 66 }, 
        signature: { x: 74, y: 73 }, // 署名坐标
        date: { x: 77, y: 78 } 
    }
};

// 强制状态检查 (防止报错)
(function fixCertState() {
    if (!G_CertState.background) G_CertState.background = { x: 0, y: 0, w: 800, h: 565 };
    if (!G_CertState.seal) G_CertState.seal = { x: 75, y: 75, w: 120, h: 120 };
})();


/**
 * 2. 渲染定制器主界面
 */
function renderCertificateCreator(container) {
    // 字体加载
    if (!document.getElementById('font-cn-mirror')) {
        const fontLink = document.createElement('link');
        fontLink.id = 'font-cn-mirror';
        fontLink.href = 'https://fonts.loli.net/css2?family=Ma+Shan+Zheng&family=Zhi+Mang+Xing&display=swap';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);
    }

    container.innerHTML = `
        <style>
            .cert-highlight { font-family: 'Ma Shan Zheng', cursive; font-size: 1.5em; color: #c0392b; margin: 0 5px; vertical-align: middle; }
            .cert-element { position: absolute; line-height: 1.6; white-space: nowrap; cursor: grab; border: 1px dashed transparent; z-index: 20; user-select: none; transform-origin: center center; }
            .cert-desc { white-space: pre-wrap; word-break: break-word; } /* 正文允许换行 */
            .cert-element:hover { border-color: #007bff; background: rgba(0,123,255,0.05); }
            .cert-element:active { cursor: grabbing; }
            
            #bg-transform-box { position: absolute; z-index: 10; border: 2px solid #20c997; display: none; pointer-events: none; }
            .resize-handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 1px solid #20c997; pointer-events: auto; z-index: 11; }
            .rh-nw { top: -6px; left: -6px; cursor: nw-resize; } .rh-n { top: -6px; left: 50%; margin-left:-5px; cursor: n-resize; }
            .rh-ne { top: -6px; right: -6px; cursor: ne-resize; } .rh-w { top: 50%; left: -6px; margin-top:-5px; cursor: w-resize; }
            .rh-e { top: 50%; right: -6px; margin-top:-5px; cursor: e-resize; } .rh-sw { bottom: -6px; left: -6px; cursor: sw-resize; }
            .rh-s { bottom: -6px; left: 50%; margin-left:-5px; cursor: s-resize; } .rh-se { bottom: -6px; right: -6px; cursor: se-resize; }

            .asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 8px; margin-top: 8px; }
            .asset-item { height: 60px; border: 2px solid #eee; border-radius: 4px; cursor: pointer; background-size: cover; background-position: center; position: relative; overflow: hidden; }
            .asset-del { position: absolute; top: 0; right: 0; background: rgba(0,0,0,0.6); color: white; font-size: 10px; padding: 2px 4px; display: none; }
            .asset-item:hover .asset-del { display: block; }
            .font-option { font-size: 14px; }
        </style>

        <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
            
            <div class="main-card-wrapper" style="flex: 1; min-width: 350px; background: #f8f9fa; border-left: 4px solid #2980b9;">
                <h4 style="margin-top:0; color:#2980b9;">🛠️ 定制面板</h4>
                
                <div class="cert-control-group" style="background: #e8f4f8; padding: 10px; border-radius: 4px; border: 1px solid #bce8f1;">
                    <label class="cert-label" style="color:#0056b3;">🚀 获奖名单选择</label>
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.85em;">
                        <span>请勾选要生成的学生：</span>
                        <div><a id="cert-sel-all" style="cursor:pointer; color:#007bff; margin-right:10px;">全选</a><a id="cert-sel-none" style="cursor:pointer; color:#666;">清空</a></div>
                    </div>
                    <div id="cert-checklist-container" style="height: 120px; overflow-y: auto; background: #fff; border: 1px solid #ccc; border-radius: 4px; padding: 5px; margin-bottom: 10px;">
                        <div style="text-align:center; color:#999; padding:20px;">-- 请先到“荣誉榜”刷新数据 --</div>
                    </div>
                    <button id="btn-batch-generate-certs" class="sidebar-button" style="width:100%; background-color:#6f42c1; font-size:0.9em;">📦 生成 ZIP 压缩包 (0)</button>
                    <div id="cert-batch-progress-box" style="display:none; margin-top:10px;">
                        <div style="width:100%; height:8px; background:#ccc; border-radius:4px; overflow:hidden;">
                            <div id="cert-batch-bar" style="width:0%; height:100%; background:#28a745; transition:width 0.3s;"></div>
                        </div>
                    </div>
                </div>

                <div class="cert-control-group">
                    <label class="cert-label">🖼️ 背景素材库</label>
                    <div style="display:flex; gap:5px; margin-bottom:5px;">
                        <label class="sidebar-button upload-btn" style="flex:1; text-align:center; background:#fff; border:1px solid #ccc; color:#333; cursor:pointer;">
                            ➕ 上传新背景 <input type="file" id="lib-bg-upload" accept="image/*" style="display:none;">
                        </label>
                        <button id="btn-bg-fit" class="sidebar-button" style="background:#20c997; font-size:0.8em; padding:4px 8px;" title="铺满">↔️</button>
                        <button id="btn-bg-reset" class="sidebar-button" style="background:#6c757d; font-size:0.8em; padding:4px 8px;" title="重置">↺</button>
                    </div>
                    <div id="lib-bg-grid" class="asset-grid"></div>

                    <label class="cert-label" style="margin-top:15px;">💮 印章素材库</label>
                    <div style="display:flex; gap:5px; margin-bottom:5px;">
                        <label class="sidebar-button upload-btn" style="flex:1; text-align:center; background:#fff; border:1px solid #ccc; color:#333; cursor:pointer;">
                            ➕ 上传新印章 <input type="file" id="lib-seal-upload" accept="image/*" style="display:none;">
                        </label>
                    </div>
                    <div id="lib-seal-grid" class="asset-grid"></div>
                </div>

                <div class="cert-control-group">
                    <label class="cert-label">✍️ 文本内容</label>
                    <input type="text" id="cert-text-title" class="cert-input" placeholder="标题" value="${G_CertState.texts.title}">
                    <input type="text" id="cert-text-winner" class="cert-input cert-input-lg" placeholder="姓名" value="${G_CertState.texts.winner}">
                    <textarea id="cert-text-desc" class="cert-input" rows="2" placeholder="正文">${G_CertState.texts.desc}</textarea>
                    <input type="text" id="cert-text-award" class="cert-input" placeholder="奖项行" value='${G_CertState.texts.award}' style="border-left:4px solid #fd7e14;">
                    
                    <div style="display:flex; gap:5px;">
                        <input type="text" id="cert-text-footer" class="cert-input" placeholder="结语" value="${G_CertState.texts.footer}" style="flex:1;">
                        <input type="text" id="cert-text-signature" class="cert-input" placeholder="署名" value="${G_CertState.texts.signature}" style="flex:1;">
                    </div>
                    <input type="text" id="cert-text-date" class="cert-input" placeholder="日期" value="${G_CertState.texts.date}" style="text-align:right;">
                </div>

                <div class="cert-control-group">
                    <label class="cert-label">🎨 样式设置</label>
                    <div style="display:flex; gap:5px; margin-bottom:10px;">
                        <select id="cert-style-font" class="cert-input" style="margin:0; flex:2;">
                            <option value='"KaiTi", "STKaiti", "楷体", serif'>楷体</option>
                            <option value='"SimSun", "宋体", serif'>宋体</option>
                            <option value='"Microsoft YaHei", sans-serif'>黑体</option>
                            <option value="'Ma Shan Zheng', cursive">✨ 马善政书法</option>
                        </select>
                        <input type="color" id="cert-style-color" value="${G_CertState.style.color}" style="height:36px; padding:0; flex:1;">
                        <select id="cert-style-align" class="cert-input" style="margin:0; flex:1;">
                            <option value="center">居中</option>
                            <option value="left">左对齐</option>
                        </select>
                    </div>
                    
                    <div style="font-size:0.8em; font-weight:bold; color:#555; margin-bottom:5px;">字号微调 (px):</div>
                    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:5px;">
                        ${['title', 'winner', 'desc', 'award', 'footer', 'signature', 'date'].map(k => {
                            const map = {title:'标题', winner:'姓名', desc:'正文', award:'奖项', footer:'结语', signature:'署名', date:'日期'};
                            return `<label style="text-align:center; font-size:0.75em;">${map[k]}<input type="number" id="size-${k}" class="pos-input" value="${G_CertState.style.sizes[k]}" style="width:100%"></label>`;
                        }).join('')}
                    </div>
                </div>

                <div class="cert-control-group">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                         <label class="cert-label">5. 排版 (X/Y%)</label>
                         <label style="font-size:0.85em;"><input type="checkbox" id="cert-layout-mode"> 启用手动排版</label>
                    </div>
                    <div id="cert-manual-controls" style="display:none; background:#eee; padding:10px; border-radius:4px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.75em; color:#666; margin-bottom:5px;">
                            <span style="margin-left:5px;">元素</span><span>X(%)</span><span>Y(%)</span>
                        </div>
                        ${['title', 'winner', 'desc', 'award', 'footer', 'signature', 'date'].map(k => {
                            const map = {title:'标题', winner:'姓名', desc:'正文', award:'奖项', footer:'结语', signature:'署名', date:'日期'};
                            return `
                            <div style="display:flex; gap:5px; margin-bottom:5px; align-items:center;">
                                <span style="width:30px; font-size:0.8em; font-weight:bold; text-align:center;">${map[k]}</span>
                                <input type="number" id="pos-x-${k}" class="pos-input" value="${G_CertState.manualPos[k].x}">
                                <input type="number" id="pos-y-${k}" class="pos-input" value="${G_CertState.manualPos[k].y}">
                            </div>`;
                        }).join('')}
                    </div>
                    
                    <div style="margin-top:10px; background:#fff5e6; padding:8px; border-radius:4px; border:1px solid #ffe082;">
                        <div style="display:flex; gap:10px; align-items:center;">
                            <label style="font-size:0.9em; font-weight:bold; color:#d35400;">💮 印章</label>
                            <label style="font-size:0.8em;">X:<input type="number" id="seal-x" class="pos-input" value="${G_CertState.seal.x}" style="width:40px;"></label>
                            <label style="font-size:0.8em;">Y:<input type="number" id="seal-y" class="pos-input" value="${G_CertState.seal.y}" style="width:40px;"></label>
                            <label style="font-size:0.8em;">宽:<input type="number" id="seal-size" class="pos-input" value="${G_CertState.seal.w}" style="width:40px;"></label>
                        </div>
                    </div>
                </div>

                <div class="cert-control-group" style="background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #ddd;">
                    <label class="cert-label">0. 纸张与布局</label>
                    <div style="display:flex; gap:10px;">
                        <select id="cert-paper-size" class="sidebar-select" style="flex:1;">
                            <option value="A4">A4</option><option value="A3">A3</option><option value="16:9">16:9</option>
                        </select>
                        <div style="display:flex; background:#eee; border-radius:4px; padding:2px;">
                            <button class="paper-orient-btn active" data-o="L" style="border:none; padding:5px 10px; cursor:pointer;">▭</button>
                            <button class="paper-orient-btn" data-o="P" style="border:none; padding:5px 10px; cursor:pointer;">▯</button>
                        </div>
                    </div>
                </div>

                <button id="btn-generate-cert" class="sidebar-button" style="width:100%; background:#2980b9; font-size:1.1em; padding: 12px;">🖨️ 生成当前预览图</button>
            </div>

            <div class="main-card-wrapper" style="flex: 2; min-width: 400px; background: #e0e0e0; padding: 20px; display: flex; justify-content: center; align-items: center; position: sticky; top: 20px; align-self: flex-start;">
                <div id="cert-canvas-container" style="width: 800px; height: 565px; background-color: #fffdf5; box-shadow: 0 10px 30px rgba(0,0,0,0.2); position: relative; overflow: hidden; user-select: none;">
                    <img id="preview-bg-img" src="" style="display:none; position:absolute; cursor:move;" draggable="false">
                    <div id="bg-transform-box">
                        <div class="resize-handle rh-nw" data-dir="nw"></div><div class="resize-handle rh-n" data-dir="n"></div>
                        <div class="resize-handle rh-ne" data-dir="ne"></div><div class="resize-handle rh-w" data-dir="w"></div>
                        <div class="resize-handle rh-e" data-dir="e"></div><div class="resize-handle rh-sw" data-dir="sw"></div>
                        <div class="resize-handle rh-s" data-dir="s"></div><div class="resize-handle rh-se" data-dir="se"></div>
                    </div>
                    <div id="preview-text-title" class="cert-element" data-key="title"></div>
                    <div id="preview-text-winner" class="cert-element" data-key="winner"></div>
                    <div id="preview-text-desc" class="cert-element cert-desc" data-key="desc"></div>
                    <div id="preview-text-award" class="cert-element" data-key="award"></div>
                    <div id="preview-text-footer" class="cert-element" data-key="footer"></div>
                    <div id="preview-text-signature" class="cert-element" data-key="signature"></div>
                    <div id="preview-text-date" class="cert-element" data-key="date"></div>
                    <img id="preview-seal-img" src="" class="cert-element" style="width:120px; opacity:0.9; mix-blend-mode:multiply; display:none;" draggable="false" data-key="seal">
                </div>
            </div>
        </div>

        <div id="cert-result-modal" class="modal-overlay" style="display: none;">
             <div class="modal-content" style="max-width: 900px; text-align: center; background: #f5f5f5;">
                <div class="modal-header"><h3>生成结果</h3><span onclick="document.getElementById('cert-result-modal').style.display='none'" class="modal-close-btn">&times;</span></div>
                <div class="modal-body" style="padding:20px;"><img id="final-cert-img" style="max-width:100%; border: 1px solid #ddd;"></div>
                <div class="modal-footer" style="justify-content: center;"><a id="btn-download-cert" class="sidebar-button" style="background-color: #27ae60;">下载图片</a></div>
            </div>
        </div>
        
        <style>
            .cert-control-group { margin-bottom: 15px; border-bottom: 1px dashed #eee; padding-bottom: 15px; }
            .cert-label { font-weight: bold; display: block; margin-bottom: 5px; color: #555; font-size: 0.9em; }
            .cert-input { width: 100%; padding: 6px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing:border-box; }
            .cert-input-lg { font-size: 1.1em; font-weight: bold; }
            .paper-orient-btn.active { background-color: #2980b9; color: white; }
            .paper-orient-btn { background-color: #ddd; color: #666; }
        </style>
    `;

    bindCertCreatorEvents();
    updateCertPreview();
    setupInteractionEngine(); 
    updateCertChecklist();
    
    initAssetLibrary('lib-bg', 'G_Asset_BG_Lib', 'bgImage');
    initAssetLibrary('lib-seal', 'G_Asset_Seal_Lib', 'sealImage');
}

/**
 * 3. 更新视图 (带防崩检查)
 */
function updateCertPreview() {
    const container = document.getElementById('cert-canvas-container');
    if (!container) return;
    const s = G_CertState;

    // 防崩检查
    if (!s.background) s.background = { x: 0, y: 0, w: 800, h: 565 };
    if (!s.seal) s.seal = { x: 75, y: 75, w: 120, h: 120 };

    // A. 纸张
    let ratio = 1.414; if (s.paper.size === '16:9') ratio = 1.777;
    const BASE = 800; let cw, ch;
    if (s.paper.orientation === 'L') { cw = BASE; ch = BASE / ratio; } else { ch = BASE; cw = BASE / ratio; }
    container.style.width = cw + 'px'; container.style.height = ch + 'px';

    // B. 背景图
    const bgImg = document.getElementById('preview-bg-img');
    const tb = document.getElementById('bg-transform-box');
    if (s.bgImage) {
        bgImg.src = s.bgImage; bgImg.style.display = 'block';
        if (!s.background.w) s.background = { x:0, y:0, w:cw, h:ch };
        bgImg.style.left = (s.background.x||0) + 'px'; bgImg.style.top = (s.background.y||0) + 'px';
        bgImg.style.width = s.background.w + 'px'; bgImg.style.height = s.background.h + 'px';
        if(tb) { tb.style.display='block'; tb.style.left=bgImg.style.left; tb.style.top=bgImg.style.top; tb.style.width=bgImg.style.width; tb.style.height=bgImg.style.height; }
    } else {
        bgImg.style.display = 'none'; if(tb) tb.style.display='none';
        container.style.backgroundColor = '#fffdf5'; container.style.backgroundImage = 'none';
    }

    // C. 文本
    container.style.fontFamily = s.style.fontFamily; container.style.color = s.style.color;

    const updateEl = (id, text, key, defaultTop) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = text; 
        el.style.fontSize = (s.style.sizes[key]||16) + 'px'; 
        
        // 对齐逻辑
        if (key === 'desc') {
            el.style.textAlign = 'left'; el.style.textIndent = '2em'; el.style.width = '80%';
        } else if (key === 'award') {
            el.style.textAlign = 'center'; el.style.width = '100%'; 
        } else if (key === 'footer' || key === 'date' || key === 'signature') {
            el.style.textAlign = 'right'; el.style.width = 'auto'; el.style.textIndent = '0';
        } else {
            el.style.textAlign = s.style.textAlign; el.style.width = 'auto'; el.style.textIndent = '0';
        }
        
        if (s.layoutMode === 'auto') {
            el.style.top = defaultTop; el.style.transform = 'none';
            if (key === 'footer' || key === 'date' || key === 'signature') { el.style.left = 'auto'; el.style.right = '10%'; }
            else if (key === 'desc') { el.style.left = '10%'; }
            else { el.style.left = '0'; el.style.right = 'auto'; el.style.width = '100%'; }
        } else {
            const pos = s.manualPos[key];
            el.style.left = pos.x + '%'; el.style.top = pos.y + '%';
            el.style.transform = 'translate(-50%, 0)';
        }
    };

    updateEl('preview-text-title', s.texts.title, 'title', '15%');
    updateEl('preview-text-winner', s.texts.winner, 'winner', '35%');
    updateEl('preview-text-desc', s.texts.desc, 'desc', '48%');
    updateEl('preview-text-award', s.texts.award, 'award', '60%');
    updateEl('preview-text-footer', s.texts.footer, 'footer', '70%');
    updateEl('preview-text-signature', s.texts.signature, 'signature', '75%');
    updateEl('preview-text-date', s.texts.date, 'date', '80%');

    // D. 印章
    const sealEl = document.getElementById('preview-seal-img');
    if (s.sealImage) {
        sealEl.src = s.sealImage; sealEl.style.display = 'block';
        sealEl.style.left = (s.seal.x||75) + '%'; sealEl.style.top = (s.seal.y||75) + '%';
        sealEl.style.width = (s.seal.w||120) + 'px';
        sealEl.style.transform = 'translate(-50%, -50%)';
    } else { sealEl.style.display = 'none'; }
}

// 4. 绑定事件 (多选列表+批量)
function bindCertCreatorEvents() {
    window.updateCertChecklist = () => {
        const container = document.getElementById('cert-checklist-container');
        const btnBatch = document.getElementById('btn-batch-generate-certs');
        if (!container) return;
        if (!window.G_Honor_List || window.G_Honor_List.length === 0) {
            container.innerHTML = `<div style="text-align:center; color:#999; padding:20px;">-- 暂无数据 --</div>`;
            if(btnBatch) btnBatch.innerText = `📦 生成 ZIP 压缩包 (0)`;
            return;
        }
        container.innerHTML = window.G_Honor_List.map((h, i) => `
            <div style="display:flex; align-items:center; padding:4px 0; border-bottom:1px dashed #eee;">
                <input type="checkbox" class="cert-batch-cb" value="${i}" id="cert-cb-${i}" checked style="margin-right:8px;">
                <label for="cert-cb-${i}" style="flex:1; cursor:pointer; font-size:0.85em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <span style="color:#d35400; font-weight:bold;">[${h.title}]</span> ${h.name}
                </label>
                <button class="sidebar-button btn-preview-single" data-idx="${i}" style="padding:2px 6px; font-size:0.75em; background:#17a2b8; margin-left:5px;" title="填充">👁️</button>
            </div>
        `).join('');
        
        const updateBtn = () => { if(btnBatch) btnBatch.innerText = `📦 生成 ZIP 压缩包 (${document.querySelectorAll('.cert-batch-cb:checked').length})`; };
        updateBtn();
        container.querySelectorAll('.cert-batch-cb').forEach(cb => cb.addEventListener('change', updateBtn));
        container.querySelectorAll('.btn-preview-single').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); fillCertData(e.target.dataset.idx); }));
    };
    
    const fillCertData = (idx) => {
        if (idx == null) return;
        const data = window.G_Honor_List[idx];
        G_CertState.texts.winner = data.name + " 同学";
        G_CertState.texts.desc = data.desc;
        G_CertState.texts.award = data.award;
        const elW = document.getElementById('cert-text-winner'); if(elW) elW.value = G_CertState.texts.winner;
        const elD = document.getElementById('cert-text-desc'); if(elD) elD.value = G_CertState.texts.desc;
        const elA = document.getElementById('cert-text-award'); if(elA) elA.value = G_CertState.texts.award;
        updateCertPreview();
    };
    
    updateCertChecklist();

    const btnAll = document.getElementById('cert-sel-all'); if(btnAll) btnAll.onclick = () => { document.querySelectorAll('.cert-batch-cb').forEach(c=>c.checked=true); document.getElementById('btn-batch-generate-certs').click(); };
    const btnNone = document.getElementById('cert-sel-none'); if(btnNone) btnNone.onclick = () => { document.querySelectorAll('.cert-batch-cb').forEach(c=>c.checked=false); };

    const btnBatch = document.getElementById('btn-batch-generate-certs');
    if (btnBatch) btnBatch.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.cert-batch-cb:checked');
        if (checked.length === 0) { alert("请勾选！"); return; }
        if (!confirm(`确定生成 ${checked.length} 张？`)) return;
        document.getElementById('cert-batch-progress-box').style.display = 'block';
        const pBar = document.getElementById('cert-batch-bar');
        btnBatch.disabled = true;
        const backup = { ...G_CertState.texts };
        const zip = new JSZip();
        const folder = zip.folder("奖状");

        for (let i = 0; i < checked.length; i++) {
            const idx = checked[i].value;
            const data = window.G_Honor_List[idx];
            pBar.style.width = `${Math.round(((i + 1) / checked.length) * 100)}%`;
            
            G_CertState.texts.winner = data.name + " 同学";
            G_CertState.texts.desc = data.desc;
            G_CertState.texts.award = data.award;
            updateCertPreview();
            await new Promise(r => setTimeout(r, 150));
            const base64 = await generateHighResCertificate(true);
            if (base64) folder.file(`${data.title}_${data.name}.jpg`, base64.split(',')[1], {base64:true});
        }
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "奖状打包.zip");
        btnBatch.disabled = false;
        G_CertState.texts = backup;
        updateCertPreview();
    });

    const bindInput = (id, cb) => { const el=document.getElementById(id); if(el) el.addEventListener('input', cb); };
    ['title', 'winner', 'desc', 'award', 'footer', 'signature', 'date'].forEach(k => {
        bindInput(`cert-text-${k}`, (e) => { G_CertState.texts[k] = e.target.value; updateCertPreview(); });
        bindInput(`size-${k}`, (e) => { G_CertState.style.sizes[k] = e.target.value; updateCertPreview(); });
        bindInput(`pos-x-${k}`, (e) => { G_CertState.manualPos[k].x = e.target.value; updateCertPreview(); });
        bindInput(`pos-y-${k}`, (e) => { G_CertState.manualPos[k].y = e.target.value; updateCertPreview(); });
    });

    const fontSel = document.getElementById('cert-style-font'); if(fontSel) fontSel.onchange = (e) => { G_CertState.style.fontFamily = e.target.value; updateCertPreview(); };
    const colorInp = document.getElementById('cert-style-color'); if(colorInp) colorInp.oninput = (e) => { G_CertState.style.color = e.target.value; updateCertPreview(); };
    const alignSel = document.getElementById('cert-style-align'); if(alignSel) alignSel.onchange = (e) => { G_CertState.style.textAlign = e.target.value; updateCertPreview(); };
    const layoutCb = document.getElementById('cert-layout-mode'); if(layoutCb) layoutCb.onchange = (e) => {
        G_CertState.layoutMode = e.target.checked ? 'manual' : 'auto';
        const mc = document.getElementById('cert-manual-controls');
        if(mc) mc.style.display = e.target.checked ? 'block' : 'none';
        updateCertPreview();
    };

    bindInput('seal-x', (e) => { G_CertState.seal.x = e.target.value; updateCertPreview(); });
    bindInput('seal-y', (e) => { G_CertState.seal.y = e.target.value; updateCertPreview(); });
    bindInput('seal-size', (e) => { G_CertState.seal.w = e.target.value; G_CertState.seal.h = e.target.value; updateCertPreview(); });

    const paperSel = document.getElementById('cert-paper-size'); if(paperSel) paperSel.onchange = (e) => { G_CertState.paper.size = e.target.value; updateCertPreview(); };
    document.querySelectorAll('.paper-orient-btn').forEach(b => b.onclick = function() {
        document.querySelectorAll('.paper-orient-btn').forEach(x=>x.classList.remove('active'));
        this.classList.add('active'); G_CertState.paper.orientation = this.dataset.o; updateCertPreview();
    });
    
    const btnFit = document.getElementById('btn-bg-fit'); if(btnFit) btnFit.onclick = () => { G_CertState.background = { x:0, y:0, w:parseInt(document.getElementById('cert-canvas-container').style.width), h:parseInt(document.getElementById('cert-canvas-container').style.height) }; updateCertPreview(); };
    const btnReset = document.getElementById('btn-bg-reset'); if(btnReset) btnReset.onclick = () => { G_CertState.background = { x:0, y:0, w:800, h:565 }; updateCertPreview(); };
    
    const genBtn = document.getElementById('btn-generate-cert');
    if(genBtn) genBtn.onclick = () => generateHighResCertificate(false);
}

// 5. 交互引擎
function setupInteractionEngine() {
    const container = document.getElementById('cert-canvas-container');
    if (window.interactionEngineBound) return;
    window.interactionEngineBound = true;

    let mode = null, startX, startY, startRect, startPos, activeKey;
    
    container.addEventListener('mousedown', (e) => {
        const t = e.target;
        startX = e.clientX; startY = e.clientY;
        
        document.body.style.userSelect = 'none';
        
        if (t.classList.contains('cert-element') || t.classList.contains('resize-handle') || t.id==='preview-bg-img') {
            if (G_CertState.layoutMode === 'auto') {
                G_CertState.layoutMode = 'manual';
                document.getElementById('cert-layout-mode').checked = true;
                document.getElementById('cert-manual-controls').style.display = 'block';
                updateCertPreview(); 
            }
        }

        if (t.classList.contains('resize-handle')) {
            mode = 'resize_bg'; startRect = { ...G_CertState.background }; e.preventDefault();
        } else if (t.id === 'preview-bg-img') {
            mode = 'move_bg'; startRect = { ...G_CertState.background }; e.preventDefault();
        } else if (t.dataset.key === 'seal') {
            mode = 'move_seal'; startPos = { x: parseFloat(G_CertState.seal.x), y: parseFloat(G_CertState.seal.y) }; e.preventDefault();
        } else if (t.classList.contains('cert-element')) {
            mode = 'move_text'; activeKey = t.dataset.key;
            startPos = { x: parseFloat(G_CertState.manualPos[activeKey].x), y: parseFloat(G_CertState.manualPos[activeKey].y) }; e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!mode) return;
        e.preventDefault();
        const dx = e.clientX - startX, dy = e.clientY - startY;
        const rect = container.getBoundingClientRect();
        
        if (mode === 'move_bg') {
            G_CertState.background.x = startRect.x + dx; G_CertState.background.y = startRect.y + dy;
        } else if (mode === 'move_seal') {
            G_CertState.seal.x = (startPos.x + (dx/rect.width)*100).toFixed(1);
            G_CertState.seal.y = (startPos.y + (dy/rect.height)*100).toFixed(1);
            const sx=document.getElementById('seal-x'), sy=document.getElementById('seal-y');
            if(sx) sx.value = G_CertState.seal.x; if(sy) sy.value = G_CertState.seal.y;
        } else if (mode === 'move_text') {
            G_CertState.manualPos[activeKey].x = (startPos.x + (dx/rect.width)*100).toFixed(1);
            G_CertState.manualPos[activeKey].y = (startPos.y + (dy/rect.height)*100).toFixed(1);
            const ix=document.getElementById(`pos-x-${activeKey}`), iy=document.getElementById(`pos-y-${activeKey}`);
            if(ix) ix.value = G_CertState.manualPos[activeKey].x; if(iy) iy.value = G_CertState.manualPos[activeKey].y;
        } else if (mode === 'resize_bg') {
            G_CertState.background.w = Math.max(20, startRect.w + dx);
            G_CertState.background.h = Math.max(20, startRect.h + dy);
        }
        requestAnimationFrame(updateCertPreview);
    });
    document.addEventListener('mouseup', () => { mode = null; document.body.style.userSelect = ''; });
}

// 6. 素材库与辅助
window.initAssetLibrary = async function(typePrefix, storageKey, targetStateKey) {
    const uploadInput = document.getElementById(`${typePrefix}-upload`);
    const gridContainer = document.getElementById(`${typePrefix}-grid`);
    if (!uploadInput || !gridContainer) return;

    let library = await localforage.getItem(storageKey) || [];
    const renderGrid = () => {
        if (library.length === 0) { gridContainer.innerHTML = `<div style="font-size:0.8em; color:#ccc; padding:10px;">暂无素材</div>`; return; }
        gridContainer.innerHTML = library.map((item, idx) => `
            <div class="asset-item" onclick="window.applyAssetData('${item}', '${targetStateKey}')" style="background-image:url('${item}');">
                <div class="asset-del" onclick="event.stopPropagation(); window.deleteAssetItem('${storageKey}', ${idx}, '${typePrefix}', '${targetStateKey}')">🗑️</div>
            </div>`).join('');
    };
    
    const newInput = uploadInput.cloneNode(true);
    uploadInput.parentNode.replaceChild(newInput, uploadInput);
    newInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            let base64 = evt.target.result;
            // 自动去白底
            if (targetStateKey === 'sealImage' && typeof removeWhiteBackground === 'function') {
                if(confirm("是否去除印章白底?")) base64 = await removeWhiteBackground(base64);
            }
            library.push(base64); await localforage.setItem(storageKey, library);
            window.applyAssetData(base64, targetStateKey); renderGrid();
        };
        reader.readAsDataURL(file);
        newInput.value = '';
    });
    renderGrid();
};

window.applyAssetData = function(base64, key) {
    G_CertState[key] = base64;
    if (key === 'bgImage') G_CertState.background = { x: 0, y: 0, w: 800, h: 565 };
    updateCertPreview();
};

window.deleteAssetItem = async function(sKey, idx, pre, tKey) {
    if(!confirm('删除?')) return;
    let lib = await localforage.getItem(sKey); lib.splice(idx, 1); await localforage.setItem(sKey, lib);
    window.initAssetLibrary(pre, sKey, tKey);
};

/**
 * [辅助函数] 图片智能去白底
 */
function removeWhiteBackground(base64Data, tolerance = 60) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                const distance = Math.sqrt((255-r)**2 + (255-g)**2 + (255-b)**2);
                if (distance < tolerance) data[i+3] = 0;
            }
            ctx.putImageData(imgData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = base64Data;
    });
}

// 7. 生成高清图
async function generateHighResCertificate(isBatch = false) {
    const dom = document.getElementById('cert-canvas-container');
    const modal = document.getElementById('cert-result-modal');
    if (!isBatch) { modal.style.display = 'flex'; document.getElementById('final-cert-img').alt = '渲染中...'; }

    const clone = dom.cloneNode(true);
    clone.style.cssText += 'position:absolute; top:-9999px; left:-9999px; margin:0; transform:none; z-index:-1;';
    
    // 隐藏变形框
    const box = clone.querySelector('#bg-transform-box');
    if(box) box.style.display = 'none';
    
    document.body.appendChild(clone);

    try {
        await new Promise(r => setTimeout(r, 100));
        const canvas = await html2canvas(clone, { scale: 4, useCORS: true, backgroundColor: null, logging: false });
        const data = canvas.toDataURL('image/jpeg', 0.9);
        
        if (isBatch) return data;
        
        document.getElementById('final-cert-img').src = data;
        const btn = document.getElementById('btn-download-cert');
        btn.href = data;
        btn.download = `奖状_${G_CertState.texts.winner.replace(/\s/g,'')}.jpg`;
    } catch (e) { console.error(e); } 
    finally { document.body.removeChild(clone); }
}


// =====================================================================
//    NEW    侧边栏模块显示管理器
// =====================================================================

// 1. 定义所有可配置的模块 (ID 对应 data-module 属性, Name 对应显示文本)
const ALL_MODULE_DEFINITIONS = [
    { id: 'dashboard', name: '📈 整体成绩分析' },
    { id: 'student', name: '👩‍🎓 学生个体报告' },
    { id: 'paper', name: '📝 试卷科目分析' },
    { id: 'single-subject', name: '🎯 单科成绩分析' },
    { id: 'boundary', name: '📊 临界生分析' },
    { id: 'holistic', name: '⚖️ 全科均衡分析' },
    { id: 'trend-distribution', name: '🌊 成绩分布变动' },
    { id: 'groups', name: '🎯 学生分层筛选' },
    { id: 'correlation', name: '🌡️ 学科关联矩阵' },
    { id: 'weakness', name: '📉 偏科诊断分析' },
    { id: 'trend', name: '🚀 成绩趋势对比' },
    { id: 'item-analysis', name: '🔬 学科小题分析' },
    { id: 'ai-advisor', name: '🤖 AI 智能分析' },
    { id: 'goal-setting', name: '🎯 目标与规划' },
    { id: 'exam-arrangement', name: '🧘 考场编排' },
    { id: 'study-groups', name: '🧩 智能互助分组' },
    { id: 'comment-gen', name: '✍️ 评语生成助手' },
    { id: 'weakness-workbook', name: '📝 错题攻坚本' },
    // 注意：'multi-exam' (数据管理中心) 不建议隐藏，因为它是数据源头，故不列入
];

// 2. 初始化管理器
function initModuleSettingsManager() {
    const openBtn = document.getElementById('module-settings-btn');
    const modal = document.getElementById('module-settings-modal');
    const closeBtn = document.getElementById('module-settings-close-btn');
    const saveBtn = document.getElementById('module-settings-save-btn');
    const listContainer = document.getElementById('module-checklist-container');

    if (!openBtn) return;

    // 加载已保存的设置 (默认全部显示)
    // 存储格式: JSON array of visible IDs
    const getSavedSettings = () => {
        const json = localStorage.getItem('App_Module_Visibility');
        if (json) return JSON.parse(json);
        // 默认所有 ID 都存在
        return ALL_MODULE_DEFINITIONS.map(m => m.id);
    };

    // 应用设置 (隐藏/显示侧边栏 LI)
    const applySettings = () => {
        const visibleIds = getSavedSettings();
        const visibleSet = new Set(visibleIds);

        ALL_MODULE_DEFINITIONS.forEach(mod => {
            // 找到对应的侧边栏链接
            const link = document.querySelector(`.sidebar a[data-module="${mod.id}"]`);
            if (link) {
                // 控制整个 li (link的父级)
                const li = link.parentElement;
                if (visibleSet.has(mod.id)) {
                    li.style.display = ''; // 恢复显示
                } else {
                    li.style.display = 'none'; // 隐藏
                }
            }
        });
    };

    // 渲染模态框内容
    const renderChecklist = () => {
        const visibleIds = new Set(getSavedSettings());

        listContainer.innerHTML = ALL_MODULE_DEFINITIONS.map(mod => {
            const isChecked = visibleIds.has(mod.id) ? 'checked' : '';
            return `
                <label style="display: flex; align-items: center; padding: 8px; background: #faf9f8ff; border-radius: 4px; border: 1px solid #eee; cursor: pointer;">
                    <input type="checkbox" value="${mod.id}" ${isChecked} style="margin-right: 10px;">
                    <span>${mod.name}</span>
                </label>
            `;
        }).join('');
    };

    // 打开模态框
    openBtn.addEventListener('click', () => {
        renderChecklist();
        modal.style.display = 'flex';
    });

    // 关闭
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // 保存
    saveBtn.addEventListener('click', () => {
        const checkboxes = listContainer.querySelectorAll('input[type="checkbox"]');
        const newVisibleIds = [];
        checkboxes.forEach(cb => {
            if (cb.checked) newVisibleIds.push(cb.value);
        });

        // 至少保留一个模块，防止全部隐藏导致不可用
        if (newVisibleIds.length === 0) {
            alert("请至少保留一个模块！");
            return;
        }

        localStorage.setItem('App_Module_Visibility', JSON.stringify(newVisibleIds));
        applySettings();
        modal.style.display = 'none';

        // 如果当前所在的模块被隐藏了，自动跳转到第一个可见模块
        const currentActive = document.querySelector('.nav-link.active');
        if (currentActive && currentActive.dataset.module && !newVisibleIds.includes(currentActive.dataset.module)) {
            // 找到第一个可见的链接并点击
            const firstVisibleId = newVisibleIds[0];
            const firstLink = document.querySelector(`.sidebar a[data-module="${firstVisibleId}"]`);
            if (firstLink) firstLink.click();
        }
    });

    // 初始化时应用一次
    applySettings();
}

// 3. 启动
document.addEventListener('DOMContentLoaded', () => {
    // 稍微延时一点，确保 DOM 结构完全就绪
    setTimeout(initModuleSettingsManager, 100);
});



// =====================================================================
//    NEW    侧边栏折叠控制器 (悬浮手柄版)
// =====================================================================
function initSidebarToggle() {
    const handle = document.getElementById('sidebar-drag-handle'); // [修改] 获取   ID
    const sidebar = document.querySelector('.sidebar');

    if (!handle || !sidebar) return;

    // 1. 读取用户上次的偏好
    const isCollapsed = localStorage.getItem('App_Sidebar_Collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
    }

    // 2. 点击事件
    handle.addEventListener('click', () => {
        // 切换 class
        sidebar.classList.toggle('collapsed');

        // 保存偏好
        const collapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('App_Sidebar_Collapsed', collapsed);

        //    关键    触发图表重绘
        // 因为侧边栏收起有 0.3s 的动画，我们需要在动画过程中或结束后调整图表大小
        setTimeout(() => {
            resizeAllCharts();
        }, 310);
    });
}

// [辅助] 重置所有 ECharts 图表大小
function resizeAllCharts() {
    for (const key in echartsInstances) {
        if (echartsInstances[key]) {
            echartsInstances[key].resize();
        }
    }
}

// 3. 启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarToggle);
} else {
    initSidebarToggle();
}


// =====================================================================
//    NEW    侧边栏宽度拖拽功能
// =====================================================================
function initSidebarResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.sidebar');

    if (!resizer || !sidebar) return;

    let isResizing = false;
    let lastDownX = 0;

    // 1. 鼠标按下 (Start)
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastDownX = e.clientX;

        // 添加样式标记
        resizer.classList.add('resizing');

        // [关键] 暂时移除过渡动画，让拖动跟手
        sidebar.classList.add('no-transition');

        // 防止选中文字
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    // 2. 鼠标移动 (Move) - 绑定到 document 以防鼠标移出侧边栏
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // 计算  宽度 (直接使用鼠标的 X 坐标作为宽度)
        // 因为侧边栏在左侧，鼠标X坐标基本上就是侧边栏的宽度
        let newWidth = e.clientX;

        // 限制最小/最大宽度 (虽然CSS有写，JS限制更流畅)
        if (newWidth < 150) newWidth = 150;
        if (newWidth > 600) newWidth = 600;

        sidebar.style.width = `${newWidth}px`;

        // 实时重绘图表 (可选，如果觉得卡顿可以去掉这一行，只在mouseup时重绘)
        // requestAnimationFrame(() => resizeAllCharts()); 
    });

    // 3. 鼠标松开 (End)
    document.addEventListener('mouseup', (e) => {
        if (!isResizing) return;

        isResizing = false;
        resizer.classList.remove('resizing');

        // [关键] 恢复过渡动画
        sidebar.classList.remove('no-transition');

        // 恢复鼠标样式
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 拖拽结束，必须重绘一次图表以适应  尺寸
        resizeAllCharts();
    });
}

// 启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarResizer);
} else {
    initSidebarResizer();
}


// =====================================================================
//    NEW    图表自适应  强 (ResizeObserver)
// =====================================================================
function initChartAutoResize() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    // 创建观察者：只要主内容区大小发生微小变化，就触发图表重绘
    const observer = new ResizeObserver(() => {
        // 使用 requestAnimationFrame 避免高频触发导致卡顿
        window.requestAnimationFrame(() => {
            resizeAllCharts();
        });
    });

    // 开始监听
    observer.observe(mainContent);
}

// 启动监听
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChartAutoResize);
} else {
    initChartAutoResize();
}

// [辅助] 重置所有 ECharts 图表大小 (  强版)
function resizeAllCharts() {
    for (const key in echartsInstances) {
        if (echartsInstances[key]) {
            // [关键] 传入参数，强制 ECharts 重  读取容器宽度
            // 否则它可能还会沿用之前的宽 canvas
            echartsInstances[key].resize({
                width: 'auto',
                height: 'auto'
            });
        }
    }
}

/**
 * [修改版] 渲染等级构成图 (支持 Raw / TScore 双模式)
 */
function renderTrendCompositionChart(elementId, currentData, compareData, mode = 'raw') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;
    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    const subjects = G_DynamicSubjectList;
    const dataMap = { curr: { A: [], B: [], C: [], D: [] }, comp: { A: [], B: [], C: [], D: [] } };

    // 内部辅助：获取单科统计
    const calcDist = (list, subject) => {
        let cA = 0, cB = 0, cC = 0, cD = 0, total = 0;
        const config = G_SubjectConfigs[subject] || {}; // 获取分数线配置

        list.forEach(s => {
            let val, isGood;
            if (mode === 'tscore') {
                val = (s.tScores && s.tScores[subject]); // T分
                // T分标准：A>=60, B>=50, C>=40
                if (val !== undefined && val !== null && !isNaN(val)) {
                    total++;
                    if (val >= 60) cA++;
                    else if (val >= 50) cB++;
                    else if (val >= 40) cC++;
                    else cD++;
                }
            } else {
                val = s.scores[subject]; // 原始分
                // 原始分标准：读取 Config
                if (val !== undefined && val !== null && !isNaN(val)) {
                    total++;
                    if (val >= config.excel) cA++;
                    else if (val >= config.good) cB++;
                    else if (val >= config.pass) cC++;
                    else cD++;
                }
            }
        });

        if (total === 0) return { A: 0, B: 0, C: 0, D: 0 };
        return {
            A: parseFloat(((cA / total) * 100).toFixed(1)),
            B: parseFloat(((cB / total) * 100).toFixed(1)),
            C: parseFloat(((cC / total) * 100).toFixed(1)),
            D: parseFloat(((cD / total) * 100).toFixed(1))
        };
    };

    subjects.forEach(sub => {
        const curr = calcDist(currentData, sub);
        const comp = calcDist(compareData, sub);
        ['A', 'B', 'C', 'D'].forEach(k => {
            dataMap.curr[k].push(curr[k]);
            dataMap.comp[k].push(comp[k]);
        });
    });

    const colors = { A: '#28a745', B: '#007bff', C: '#ffc107', D: '#dc3545' };
    const titleText = mode === 'tscore' ? '各科 T分等级构成 (A:T≥60, B:≥50, C:≥40)' : '各科 原始分等级构成 (基于优秀/良好/及格线)';

    const option = {
        title: { text: titleText, left: 'center', textStyle: { fontSize: 14, fontWeight: 'normal', color: '#666' }, top: 5 },
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            formatter: (params) => {
                let html = `<strong>${params[0].name}</strong><br/>`;
                html += `<div style="display:inline-block; width:49%; vertical-align:top;">`;
                html += `<div style="border-bottom:1px solid #eee; margin-bottom:5px;">📘 本次</div>`;
                params.filter(p => p.seriesName.startsWith('本次')).reverse().forEach(p => html += `${p.marker} ${p.seriesName.split('-')[1]}: ${p.value}%<br/>`);
                html += `</div>`;
                html += `<div style="display:inline-block; width:49%; vertical-align:top; margin-left:2%;">`;
                html += `<div style="border-bottom:1px solid #eee; margin-bottom:5px; color:#999;">📓 上次</div>`;
                params.filter(p => p.seriesName.startsWith('上次')).reverse().forEach(p => html += `${p.marker} ${p.seriesName.split('-')[1]}: ${p.value}%<br/>`);
                html += `</div>`;
                return html;
            }
        },
        legend: { data: ['A (优秀)', 'B (良好)', 'C (及格)', 'D (不及格)'], bottom: 0 },
        grid: { left: '3%', right: '4%', bottom: '10%', top: '15%', containLabel: true },
        xAxis: { type: 'category', data: subjects, axisLabel: { rotate: 30, interval: 0 } },
        yAxis: { type: 'value', max: 100, name: '百分比 (%)' },
        series: [
            { name: '本次-D (不及格)', stack: 'current', type: 'bar', data: dataMap.curr.D, itemStyle: { color: colors.D }, barGap: 0 },
            { name: '本次-C (及格)', stack: 'current', type: 'bar', data: dataMap.curr.C, itemStyle: { color: colors.C } },
            { name: '本次-B (良好)', stack: 'current', type: 'bar', data: dataMap.curr.B, itemStyle: { color: colors.B } },
            { name: '本次-A (优秀)', stack: 'current', type: 'bar', data: dataMap.curr.A, itemStyle: { color: colors.A } },

            { name: '上次-D (不及格)', stack: 'compare', type: 'bar', data: dataMap.comp.D, itemStyle: { color: colors.D, opacity: 0.4 } },
            { name: '上次-C (及格)', stack: 'compare', type: 'bar', data: dataMap.comp.C, itemStyle: { color: colors.C, opacity: 0.4 } },
            { name: '上次-B (良好)', stack: 'compare', type: 'bar', data: dataMap.comp.B, itemStyle: { color: colors.B, opacity: 0.4 } },
            { name: '上次-A (优秀)', stack: 'compare', type: 'bar', data: dataMap.comp.A, itemStyle: { color: colors.A, opacity: 0.4 } },

            // 代理图例
{ 
                name: 'A (优秀)', type: 'bar', stack: 'current', data: [], 
                itemStyle: { color: colors.A } 
            },
            { 
                name: 'B (良好)', type: 'bar', stack: 'current', data: [], 
                itemStyle: { color: colors.B } 
            },
            { 
                name: 'C (及格)', type: 'bar', stack: 'current', data: [], 
                itemStyle: { color: colors.C } 
            },
            { 
                name: 'D (不及格)', type: 'bar', stack: 'current', data: [], 
                itemStyle: { color: colors.D } 
            }
        ]
    };
    echartsInstances[elementId].setOption(option);
}


/**
 * 13.9. 批量导入知识点配置
 */
function batchImportKnowledge() {
    const textarea = document.getElementById('item-config-batch-knowledge');
    const inputContent = textarea.value.trim();

    if (!inputContent) {
        alert("请先在文本框中粘贴知识点内容。");
        return;
    }

    // 1. 按行分割内容
    const knowledgeList = inputContent.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (knowledgeList.length === 0) {
        alert("粘贴的内容为空或无法识别换行。");
        return;
    }

    // 2. 获取配置表格中的所有行
    const tbody = document.getElementById('item-config-table-body');
    if (!tbody) return;
    
    // 3. [核心修改] 筛选出需要填充的【小题】行
    const qRows = Array.from(tbody.querySelectorAll('tr')).filter(row => {
        // 获取第一列的文本，检查它是否以数字开头 (例如 "1 (小题)", "10 (小题)")
        const firstCellText = row.cells[0]?.textContent.trim() || '';
        // 使用正则表达式判断：必须以数字开头，并且包含括号和“小题”字样
        return /^\d+\s*\(小题\)$/i.test(firstCellText);
    });

    if (qRows.length === 0) {
        alert("⚠️ 错误：表格中没有检测到可配置的小题。");
        return;
    }

    let matchCount = 0;
    
    // 4. 遍历知识点列表并按顺序匹配筛选后的行
    for (let i = 0; i < knowledgeList.length; i++) {
        const knowledge = knowledgeList[i];
        const row = qRows[i]; // 按顺序匹配【小题】

        if (row) {
            // 找到对应的知识点输入框并赋值
            const contentInput = row.querySelector('.item-config-content');
            if (contentInput) {
                contentInput.value = knowledge;
                matchCount++;
            }
        } else {
            // 知识点数量多于表格中的小题数量，停止匹配
            break;
        }
    }

    if (matchCount > 0) {
        alert(`🎉 成功导入 ${matchCount} 个知识点到小题。`);
        // 清空文本框，方便下次使用
        textarea.value = ''; 
    } else {
        alert("⚠️ 导入失败，请确认粘贴的知识点数量与小题数量是否匹配。");
    }
}


/**
 * 13.10. 清空所有题目的知识点配置
 */
function clearAllKnowledgeConfig() {
    if (!confirm("⚠️ 确定要清空当前科目配置中所有题目的【考察内容（知识点）】吗？此操作不可撤销，需要手动保存后才会生效！")) {
        return;
    }

    const tbody = document.getElementById('item-config-table-body');
    if (!tbody) return;

    const contentInputs = tbody.querySelectorAll('.item-config-content');

    if (contentInputs.length === 0) {
        alert("配置表格中没有找到可清空的知识点输入框。");
        return;
    }
    
    let clearCount = 0;
    contentInputs.forEach(input => {
        if (input.value !== "") {
            input.value = "";
            clearCount++;
        }
    });

    alert(`🗑️ 成功清空了 ${clearCount} 个知识点的配置！\n请务必点击下方的【保存配置】按钮以生效。`);
}

/**
 * [升级版] 10.22. 渲染分数段平滑曲线图
 * - 支持：单科分布、全科对比
 * - 新增：各班级对比 (isClassCompare = true)
 */
function renderScoreCurve(elementId, students, subject, binSize, isClassCompare = false) {
    const chartDom = document.getElementById(elementId);
    const analysisDiv = document.getElementById('curve-analysis-text');
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    const isAllSubjects = (subject === 'ALL_SUBJECTS');
    let series = [];
    let categories = [];
    let analysisText = "";
    const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];

    // ============================================================
    // 模式 A: 全科对比 (原逻辑保持不变，强制关闭班级对比)
    // ============================================================
    if (isAllSubjects) {
        // ... (保留你原有的全科对比逻辑，此处省略重复代码以节省篇幅，逻辑与之前一致) ...
        // 简单起见，建议全科对比时不支持班级对比，因为线条太多会乱
        
        // 1. 确定全局最大分
        let globalMax = 0;
        G_DynamicSubjectList.forEach(sub => {
            const subScores = students.map(s => s.scores[sub]).filter(v => typeof v === 'number');
            if(subScores.length > 0) globalMax = Math.max(globalMax, Math.max(...subScores));
        });
        
        const endBin = Math.ceil((globalMax + 1) / binSize) * binSize;
        for (let i = 0; i < endBin; i += binSize) {
            categories.push(`[${i},${i + binSize})`);
        }

        G_DynamicSubjectList.forEach((sub, idx) => {
            const subScores = students.map(s => s.scores[sub]).filter(v => typeof v === 'number');
            const data = new Array(categories.length).fill(0);
            subScores.forEach(score => {
                let binIndex = Math.floor(score / binSize);
                if (binIndex >= data.length) binIndex = data.length - 1;
                data[binIndex]++;
            });
            
            series.push({
                name: sub, type: 'line', smooth: 0.4, symbol: 'none', data: data,
                itemStyle: { color: colors[idx % colors.length] }, lineStyle: { width: 2.5 }
            });
        });
        analysisText = "全科对比展示了各学科的分布形态差异。";
    } 
    
    // ============================================================
    // 模式 B: 班级对比 (新增核心逻辑)
    // ============================================================
    else if (isClassCompare) {
        // 1. 获取所有班级列表
        const classSet = new Set(students.map(s => s.class));
        const classes = Array.from(classSet).sort();

        // 2. 确定该科目在全校范围内的最大分 (统一 X 轴)
        const allScores = students.map(s => subject === 'totalScore' ? s.totalScore : s.scores[subject])
                                  .filter(v => typeof v === 'number' && !isNaN(v));
        
        if (allScores.length === 0) {
            chartDom.innerHTML = `<p style="text-align:center; padding-top:50px; color:#999;">无有效分数数据</p>`;
            return;
        }

        const maxScore = Math.max(...allScores);
        const endBin = Math.ceil((maxScore + 1) / binSize) * binSize;

        // 生成 X 轴标签
        for (let i = 0; i < endBin; i += binSize) {
            categories.push(`[${i},${i + binSize})`);
        }

        // 3. 遍历每个班级生成 Series
        classes.forEach((className, idx) => {
            const classStudents = students.filter(s => s.class === className);
            const scores = classStudents.map(s => subject === 'totalScore' ? s.totalScore : s.scores[subject])
                                        .filter(v => typeof v === 'number' && !isNaN(v));
            
            const data = new Array(categories.length).fill(0);
            
            scores.forEach(score => {
                let binIndex = Math.floor(score / binSize);
                if (binIndex >= data.length) binIndex = data.length - 1;
                data[binIndex]++;
            });

            series.push({
                name: className,
                type: 'line',
                smooth: 0.4,
                symbol: 'circle', // 显示点，方便看具体数据
                symbolSize: 6,
                data: data,
                itemStyle: { color: colors[idx % colors.length] },
                lineStyle: { width: 2 },
                // 区域填充设为透明或很淡，防止重叠看不清
                areaStyle: { opacity: 0.05, color: colors[idx % colors.length] }
            });
        });

        analysisText = `当前展示 <strong>${subject}</strong> 科目在 <strong>${classes.length}</strong> 个班级间的分布对比。您可以点击上方图例隐藏/显示特定班级。曲线越向右偏移，说明该班级高分段人数越多。`;
    }

    // ============================================================
    // 模式 C: 单一群体分布 (原逻辑)
    // ============================================================
    else {
        const scores = students.map(s => subject === 'totalScore' ? s.totalScore : s.scores[subject])
                               .filter(val => typeof val === 'number' && !isNaN(val));

        if (scores.length === 0) {
            chartDom.innerHTML = `<p style="text-align:center; padding-top:50px; color:#999;">无有效分数数据</p>`;
            return;
        }

        const min = Math.min(...scores);
        const max = Math.max(...scores);
        const startBin = Math.floor(min / binSize) * binSize;
        const endBin = Math.ceil((max + 1) / binSize) * binSize;
        
        const binMap = {};
        for (let i = startBin; i < endBin; i += binSize) {
            const label = `[${i},${i + binSize})`;
            categories.push(label);
            binMap[label] = 0;
        }

        scores.forEach(score => {
            let binStart = Math.floor(score / binSize) * binSize;
            if (binStart < startBin) binStart = startBin; 
            if (binStart >= endBin) binStart = endBin - binSize;
            const label = `[${binStart},${binStart + binSize})`;
            if (binMap[label] !== undefined) binMap[label]++;
        });

        const data = categories.map(cat => binMap[cat]);
        
        // 生成简易分析文案
        let maxCount = Math.max(...data);
        let peakIndex = data.indexOf(maxCount);
        analysisText = `本次统计成绩分布峰值出现在 <strong>${categories[peakIndex]}</strong>，有 <strong>${maxCount}</strong> 人。`;

        series.push({
            name: '人数',
            type: 'line',
            smooth: 0.4,
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: true,
            itemStyle: { color: '#20c997', borderColor: '#fff', borderWidth: 2 },
            lineStyle: { width: 3, color: '#20c997' },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(32, 201, 151, 0.3)' },
                    { offset: 1, color: 'rgba(32, 201, 151, 0.05)' }
                ])
            },
            data: data,
            label: { show: true, position: 'top', color: '#20c997', fontSize: 12, fontWeight: 'bold' },
            markPoint: { data: [{ type: 'max', name: '最大值' }], itemStyle: { color: '#ffc107' } }
        });
    }

    // 更新分析文案
    if (analysisDiv) analysisDiv.innerHTML = analysisText;

    // ECharts 配置
    const option = {
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#ccc',
            textStyle: { color: '#333' },
            formatter: (params) => {
                let html = `<strong>${params[0].name}</strong><br/>`;
                // 按人数从多到少排序显示 Tooltip
                const sortedParams = [...params].sort((a, b) => b.value - a.value);
                sortedParams.forEach(p => {
                    const marker = p.marker || `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${p.color};"></span>`;
                    if (p.value > 0) {
                        html += `${marker} ${p.seriesName}: <strong>${p.value}</strong>人<br/>`;
                    }
                });
                return html;
            }
        },
        legend: {
            show: isClassCompare || isAllSubjects, // 对比模式下显示图例
            top: 0,
            type: 'scroll',
            width: '80%'
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '10%',
            top: (isClassCompare || isAllSubjects) ? '15%' : '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: categories,
            axisLabel: {
                interval: 'auto',
                rotate: categories.length > 10 ? 30 : 0,
                color: '#666'
            },
            axisLine: { lineStyle: { color: '#ccc' } },
            axisTick: { show: false }
        },
        yAxis: {
            type: 'value',
            name: '人数',
            splitLine: { lineStyle: { type: 'dashed', color: '#eee' } },
            axisLine: { show: false },
            axisTick: { show: false }
        },
        series: series
    };

    myChart.setOption(option, true); // true 表示不合并旧配置，彻底重绘
}

/**
 *    13.21 绘制分层学生名单表格 (自动计算缺失的排名)
 */
function drawLayerStudentTable() {
    const tbody = document.getElementById('item-layer-tbody');
    const select = document.getElementById('item-layer-list-select');
    if (!tbody || !select) return;

    // 1. 获取环境参数
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);

    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) return;
    
    // 获取该科目下的所有学生
    const allStudents = G_ItemAnalysisData[subjectName].students;

    // ============================================================
    //    自动补全排名 (如果数据中缺失)
    // ============================================================
    // 检查第一个有效学生是否有排名数据
    const sample = allStudents.find(s => typeof s.totalScore === 'number');
    
    if (sample && (sample.rank === undefined || sample.gradeRank === undefined || sample.rank === null)) {
        // A. 计算年级排名 (按分数降序)
        // 注意：这里是基于“当前科目”的分数进行排名，这是最符合小题分析场景的
        const sortedByGrade = [...allStudents].filter(s => typeof s.totalScore === 'number')
            .sort((a, b) => b.totalScore - a.totalScore);
            
        sortedByGrade.forEach((s, index) => {
            s.gradeRank = index + 1;
        });

        // B. 计算班级排名 (按班级分组后排序)
        const classMap = {};
        allStudents.forEach(s => {
            if (typeof s.totalScore === 'number') {
                if (!classMap[s.class]) classMap[s.class] = [];
                classMap[s.class].push(s);
            }
        });

        Object.keys(classMap).forEach(className => {
            const classGroup = classMap[className];
            classGroup.sort((a, b) => b.totalScore - a.totalScore);
            classGroup.forEach((s, index) => {
                s.rank = index + 1;
            });
        });
    }
    // ============================================================

    // 2. 筛选 (基于班级)
    const filteredStudents = (selectedClass === 'ALL') 
        ? allStudents 
        : allStudents.filter(s => s.class === selectedClass);

    // 3. 排序 (用于分层逻辑)
    const validStudents = filteredStudents
        .filter(s => typeof s.totalScore === 'number' && !isNaN(s.totalScore))
        .sort((a, b) => b.totalScore - a.totalScore); // 高分在前

    if (validStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#999;">无有效数据</td></tr>`;
        return;
    }

    // 4. 分层逻辑 (计算分层区间)
    const groupSize = Math.ceil(validStudents.length / numGroups);
    const groups = [];
    for (let i = 0; i < numGroups; i++) {
        const group = validStudents.slice(i * groupSize, (i + 1) * groupSize);
        if (group.length > 0) {
            const maxScore = group[0].totalScore;
            const minScore = group[group.length - 1].totalScore;
            groups.push({
                id: `G${i + 1}`,
                name: `G${i + 1} (第${i * groupSize + 1}-${Math.min((i + 1) * groupSize, validStudents.length)}名)`,
                range: `${minScore} - ${maxScore}分`,
                students: group
            });
        }
    }

    // 5. 填充下拉框
    const currentVal = select.value;
    let htmlOpts = '';
    groups.forEach(g => {
        htmlOpts += `<option value="${g.id}">${g.name} [${g.range}]</option>`;
    });
    
    if (select.innerHTML !== htmlOpts) {
        select.innerHTML = htmlOpts;
        if (currentVal && groups.some(g => g.id === currentVal)) {
            select.value = currentVal;
        } else {
            select.value = 'G1';
        }
    }

    // 6. 获取当前选中层级的学生并渲染
    const selectedGroupId = select.value;
    const targetGroup = groups.find(g => g.id === selectedGroupId);

    if (!targetGroup) {
        tbody.innerHTML = '';
        return;
    }

    tbody.innerHTML = targetGroup.students.map(s => {
        return `
            <tr>
                <td><span style="font-weight:bold; color:#17a2b8;">${targetGroup.id}</span></td>
                <td style="font-weight:bold;">${s.name}</td>
                <td>${s.class}</td>
                <td style="font-weight:bold; color:#007bff;">${s.totalScore}</td>
                <td style="color:#666;">-</td> 
                <td>${s.rank || '-'}</td>
                <td>${s.gradeRank || '-'}</td>
            </tr>
        `;
    }).join('');
}

/**
 * 16.5 [终极修复版] 处理身高/性别 Excel 上传
 */
function handlePhysicalDataUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // 使用 FileReader 直接读取，绕过 loadExcelData 的严格限制
    const reader = new FileReader();
    
    reader.onload = (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // 直接转为最原始的 JSON 数据
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            if (jsonData.length === 0) {
                alert("文件似乎是空的，请检查 Excel 内容。");
                return;
            }

            // --- 核心修复：模糊匹配辅助函数 ---
            // 即使表头是 " 身高 " (带空格)，也能通过 ['身高', 'height'] 找到
            const findValue = (row, keywords) => {
                // 1. 获取该行所有的 Key (表头)
                const keys = Object.keys(row);
                // 2. 遍历 Key，去掉空格后对比
                for (const key of keys) {
                    const cleanKey = key.trim().replace(/\s+/g, ''); // 去除所有空格
                    if (keywords.some(kw => cleanKey.includes(kw))) {
                        return row[key];
                    }
                }
                return undefined;
            };

            let count = 0;
            G_PhysicalData = {}; // 重置全局数据

            jsonData.forEach(row => {
                // 使用模糊匹配查找列
                const name = findValue(row, ['姓名', 'Name', 'name']);
                const gender = findValue(row, ['性别', 'Gender', 'gender', 'sex']);
                const heightVal = findValue(row, ['身高', 'Height', 'height']);

                if (name) {
                    // 简单清洗数据
                    const cleanHeight = parseFloat(heightVal) || 0;
                    const cleanGender = gender ? String(gender).trim() : '未知';

                    // 同时以“姓名”为索引保存
                    // (因为这个 Excel 没有学号，我们用姓名来匹配系统里的学生)
                    G_PhysicalData[name.trim()] = { 
                        height: cleanHeight, 
                        gender: cleanGender 
                    };
                    count++;
                }
            });
            
            if (count === 0) {
                alert("未识别到有效数据。\n请确保表头包含：姓名、性别、身高。");
                document.getElementById('seat-upload-status').innerHTML = `❌ 读取失败`;
            } else {
                document.getElementById('seat-upload-status').innerHTML = `✅ 成功读取 ${count} 人数据`;
                document.getElementById('seat-upload-status').style.color = '#28a745';
                console.log("导入预览:", G_PhysicalData); // 方便你在控制台查看是否导入成功
            }
            
        } catch (err) {
            console.error(err);
            alert("解析出错: " + err.message);
        }
        
        // 重置控件，允许重复上传
        e.target.value = '';
    };
    
    reader.readAsArrayBuffer(file);
}



/**
 * 16.7 [视觉旗舰版] 渲染座位图
 * - 新增：顶部图例 (Legend)，显示小组颜色
 * - 优化：根据学生所属小组，给座位块(Desk Block)添加彩色边框
 * - 保持：男生蓝/女生粉的座位底色
 */
function renderSeatingVisuals(seatMap) {
    const container = document.getElementById('seat-map-container');
    document.getElementById('seat-result-area').style.display = 'block';
    
    // 1. 提取所有出现的小组，并分配颜色
    const groupsSet = new Set();
    seatMap.forEach(row => {
        row.forEach(block => {
            if (block.students) {
                block.students.forEach(s => {
                    if (s && s._group && s._group !== '未分组') groupsSet.add(s._group);
                });
            }
        });
    });
    // 排序：第1组, 第2组...
    const groupsList = Array.from(groupsSet).sort((a, b) => a.localeCompare(b, 'zh-CN', {numeric: true}));

    // 定义一组鲜明的颜色 (用于边框和图例)
    const palette = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
        '#F7DC6F', '#BB8FCE', '#82E0AA', '#F1948A', '#85C1E9'
    ];
    const groupColorMap = {};
    groupsList.forEach((g, i) => {
        groupColorMap[g] = palette[i % palette.length];
    });

    // 2. 生成图例 HTML
    let legendHtml = '';
    if (groupsList.length > 0) {
        legendHtml = `<div class="legend-bar">`;
        groupsList.forEach(g => {
            const color = groupColorMap[g];
            legendHtml += `
                <div class="legend-item">
                    <span class="legend-dot" style="background:${color}"></span>
                    <span>${g}</span>
                </div>
            `;
        });
        legendHtml += `</div>`;
    }

    // 3. 生成座位表 HTML
    let html = legendHtml;
    html += `<div class="blackboard">📺 讲台 / 黑板</div>`;
    html += `<div class="classroom-grid">`;
    
    seatMap.forEach((row, rIdx) => {
        html += `<div class="seat-row">`;
        row.forEach((block, bIdx) => {
            // 确定该 Block 的颜色 (取第一个有组的学生)
            let borderColor = '#ddd'; // 默认灰
            let blockGroup = '';
            
            // 查找该桌是否有已分组学生
            const firstGroupedStudent = block.students.find(s => s && s._group && groupColorMap[s._group]);
            if (firstGroupedStudent) {
                blockGroup = firstGroupedStudent._group;
                borderColor = groupColorMap[blockGroup];
            }

            // 渲染 Block (加粗边框显示小组色)
            const borderStyle = blockGroup ? `border: 2px solid ${borderColor}; background: ${borderColor}11;` : '';
            
            html += `<div class="desk-block" style="${borderStyle}">`;
            
            // 渲染座位
            block.students.forEach(s => {
                if (!s) { // 空座
                     html += `<div class="seat empty">空</div>`;
                } else {
                    const genderClass = s._gender === '女' ? 'girl' : (s._gender === '男' ? 'boy' : 'unknown');
                    html += `
                        <div class="seat ${genderClass}">
                            <div class="seat-name" title="${s.name} (${s._gender}, ${s._height}cm)">${s.name}</div>
                        </div>
                    `;
                }
            });
            
            // 补齐空位
            for(let i=0; i < block.size - block.students.length; i++) {
                 html += `<div class="seat empty">空</div>`;
            }
            html += `</div>`; // end desk-block
            
            // 过道
            if (bIdx < row.length - 1) html += `<div class="aisle"></div>`;
        });
        html += `</div>`; // end seat-row
    });
    html += `</div>`;
    
    const style = `
        <style>
            .legend-bar { 
                display: flex; justify-content: center; flex-wrap: wrap; gap: 15px; 
                margin-bottom: 20px; padding: 10px; background: #fff; border-radius: 8px; border: 1px solid #eee; 
            }
            .legend-item { display: flex; align-items: center; gap: 5px; font-size: 0.9em; color: #555; }
            .legend-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }

            .blackboard { background: #333; color: #fff; padding: 10px; margin-bottom: 30px; border-radius: 4px; width: 200px; margin-left: auto; margin-right: auto; }
            .seat-row { display: flex; justify-content: center; margin-bottom: 15px; }
            
            .desk-block { 
                display: flex; gap: 4px; 
                padding: 4px; 
                border: 1px solid #ddd; /* 默认边框 */
                border-radius: 6px; 
                background: #f9f9f9;
                min-width: 70px;
                transition: all 0.3s;
            }
            .aisle { width: 30px; } 
            
            .seat { 
                width: 65px; height: 55px; 
                display: flex; flex-direction: column; justify-content: center; align-items: center;
                border-radius: 4px; font-size: 0.85em;
                border: 1px solid rgba(0,0,0,0.05);
                position: relative;
            }
            .seat.boy { background-color: #bbdefb; color: #0d47a1; } /* 蓝 */
            .seat.girl { background-color: #f8bbd0; color: #880e4f; } /* 粉 */
            .seat.unknown { background-color: #fff; color: #666; border: 1px dashed #ccc; }
            .seat.empty { background-color: #f0f0f0; color: #ccc; border: 1px dashed #ddd; }
            
            .seat-name { font-weight: bold; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        </style>
    `;
    
    container.innerHTML = style + html;
}

/**
 * 16.8 导出座位表 Excel
 */
function exportSeatingChart() {
    if (!G_CurrentSeatMap) return;
    
    const wb = XLSX.utils.book_new();
    const data = [];
    
    // 讲台行
    data.push(["讲台", "", "", "", ""]);
    data.push([]); // 空行
    
    G_CurrentSeatMap.forEach((row, rIdx) => {
        const rowArr = [];
        row.forEach((block, bIdx) => {
             block.students.forEach(s => {
                 rowArr.push(`${s.name}\n(${s._height.toFixed(0)}cm)`);
             });
             // 补空位
             for(let i=0; i < block.size - block.students.length; i++) rowArr.push("空");
             
             // 模拟过道 (插入空列)
             if (bIdx < row.length - 1) rowArr.push(""); 
        });
        data.push(rowArr);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // 设置列宽
    const wscols = [];
    for(let i=0; i<20; i++) wscols.push({wch: 12});
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, "座位表");
    XLSX.writeFile(wb, "班级座位表.xlsx");
}



// ==========================================
//  模块十六：增强功能 (存档 & 数据管理)
// ==========================================

// --- 1. 学习分组存档管理器 ---
async function initGroupArchiveManager() {
    const listContainer = document.getElementById('group-archive-list');
    const saveBtn = document.getElementById('btn-save-group-archive');
    if (!listContainer) return;

    // 渲染列表
    const renderList = async () => {
        const archives = await localforage.getItem('G_Group_Archives') || [];
        if (archives.length === 0) {
            listContainer.innerHTML = `<div style="text-align:center; color:#999; padding:10px; font-size:0.9em;">暂无存档，生成分组后可点击右上角保存。</div>`;
            return;
        }
        listContainer.innerHTML = archives.map((item, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #f0f0f0;">
                <div onclick="window.loadGroupArchive(${item.id})" style="cursor:pointer; flex:1;">
                    <strong style="color:#6f42c1;">${item.name}</strong>
                    <span style="font-size:0.8em; color:#999; margin-left:10px;">${item.date} (${item.className})</span>
                </div>
                <button onclick="window.deleteGroupArchive(${item.id})" style="border:none; background:none; color:#dc3545; cursor:pointer;">&times;</button>
            </div>
        `).join('');
    };

    // 绑定保存
    saveBtn.onclick = async () => {
        if (!window.currentGroupsCache || window.currentGroupsCache.length === 0) {
            alert("当前没有生成的分组数据！"); return;
        }
        const name = prompt("为该分组方案命名:", "分组-" + new Date().toLocaleDateString());
        if (!name) return;

        const className = document.getElementById('group-class-select').value;
        const record = {
            id: Date.now(),
            name: name,
            date: new Date().toLocaleString(),
            className: className,
            groups: window.currentGroupsCache
        };

        const archives = await localforage.getItem('G_Group_Archives') || [];
        archives.unshift(record);
        await localforage.setItem('G_Group_Archives', archives);
        alert("✅ 存档成功！");
        renderList();
    };

    // 全局加载函数
    window.loadGroupArchive = async (id) => {
        const archives = await localforage.getItem('G_Group_Archives');
        const record = archives.find(r => r.id === id);
        if (record) {
            if(!confirm(`确定加载存档【${record.name}】吗？\n这将覆盖当前屏幕上的显示。`)) return;
            window.currentGroupsCache = record.groups;
            renderGroupVisuals(record.groups, record.className, 'archive'); // 渲染
            alert(`已加载 ${record.name}`);
        }
    };

    // 全局删除函数
    window.deleteGroupArchive = async (id) => {
        if(!confirm("确定删除此存档？")) return;
        let archives = await localforage.getItem('G_Group_Archives');
        archives = archives.filter(r => r.id !== id);
        await localforage.setItem('G_Group_Archives', archives);
        renderList();
    };

    renderList();
}


// --- 2. [修复版] 身高数据管理器 (防崩溃) ---
function initPhysicalDataManager() {
    const classSelect = document.getElementById('seat-class-select');
    const uploadInput = document.getElementById('seat-physical-upload');
    const saveBtn = document.getElementById('btn-save-physical');
    const clearBtn = document.getElementById('btn-clear-physical');
    const statusLabel = document.getElementById('seat-db-status'); // 注意：AI版把状态放在了标题栏

    // 如果核心元素不存在，直接退出，防止报错
    if (!classSelect || !uploadInput) return;

    // 加载当前班级的数据状态
    const checkStatus = async () => {
        const cls = classSelect.value;
        const allData = await localforage.getItem('G_Physical_DB') || {};
        
        if (allData[cls]) {
            const count = Object.keys(allData[cls]).length;
            if (statusLabel) {
                statusLabel.innerHTML = `✅ <strong>${cls}</strong> 已存档 (${count}人)`;
                statusLabel.style.color = "#28a745";
            }
            // [安全检查] 按钮存在才操作
            if (clearBtn) clearBtn.style.display = 'inline-block';
            if (saveBtn) saveBtn.style.display = 'none'; 
            
            G_PhysicalData = allData[cls];
        } else {
            if (statusLabel) {
                statusLabel.innerHTML = `⚪ ${cls} 暂无数据`;
                statusLabel.style.color = "#999";
            }
            if (clearBtn) clearBtn.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
            G_PhysicalData = {}; 
        }
    };

    // 绑定事件
    classSelect.addEventListener('change', checkStatus);

    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                
                const findValue = (row, keywords) => {
                    for (const key of Object.keys(row)) {
                        if (keywords.some(kw => key.trim().includes(kw))) return row[key];
                    }
                    return undefined;
                };

                let tempPhysicalData = {};
                let count = 0;

                jsonData.forEach(row => {
                    const name = findValue(row, ['姓名', 'Name']);
                    const gender = findValue(row, ['性别', 'Gender']);
                    const heightVal = findValue(row, ['身高', 'Height']);

                    if (name) {
                        tempPhysicalData[name.trim()] = { 
                            height: parseFloat(heightVal) || 0, 
                            gender: gender ? String(gender).trim() : '未知' 
                        };
                        count++;
                    }
                });

                if (count > 0) {
                    G_PhysicalData = tempPhysicalData;
                    if (statusLabel) {
                        statusLabel.innerHTML = `📂 待保存: 读取到 ${count} 人`;
                        statusLabel.style.color = "#fd7e14";
                    }
                    if (saveBtn) saveBtn.style.display = 'inline-block';
                } else {
                    alert("未识别到有效数据，请检查表头。");
                }
            } catch (err) {
                alert("解析失败: " + err.message);
            }
            e.target.value = '';
        };
        reader.readAsArrayBuffer(file);
    });

    // [安全绑定] 保存按钮
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const cls = classSelect.value;
            if (Object.keys(G_PhysicalData).length === 0) return;

            let allData = await localforage.getItem('G_Physical_DB') || {};
            allData[cls] = G_PhysicalData;
            await localforage.setItem('G_Physical_DB', allData);
            
            alert(`✅ ${cls} 的特征数据已保存！`);
            checkStatus();
        });
    }

    // [安全绑定] 删除按钮
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            const cls = classSelect.value;
            if (!confirm(`确定要删除【${cls}】的身高性别存档吗？`)) return;

            let allData = await localforage.getItem('G_Physical_DB') || {};
            delete allData[cls];
            await localforage.setItem('G_Physical_DB', allData);
            checkStatus();
        });
    }

    // 初始检查
    checkStatus();
}

/**
 * [补全] 绑定 Tab 1 (学习互助分组) 的相关事件
 */
function bindStudyGroupEvents() {
    const strategySelect = document.getElementById('group-strategy');
    const sortSelect = document.getElementById('group-sort-basis');
    const sizeWrapper = document.getElementById('group-size-wrapper');
    const singleWrapper = document.getElementById('group-single-wrapper');
    const compWrapper = document.getElementById('group-comp-wrapper');
    const descBox = document.getElementById('group-strategy-desc');

    // UI 联动更新
    const updateUI = () => {
        const st = strategySelect.value;
        const so = sortSelect.value;

        const sizeInput = document.getElementById('group-size-input');
        if (st === 'high_low') {
            sizeInput.value = 2;
            sizeInput.disabled = true;
        } else {
            sizeInput.disabled = false;
        }

        sizeWrapper.style.display = 'none';
        singleWrapper.style.display = 'none';
        compWrapper.style.display = 'none';

        if (so === 'single') singleWrapper.style.display = 'block';
        else if (so === 'complementary') compWrapper.style.display = 'block';

        if (st !== 'high_low') sizeWrapper.style.display = 'block';

        let text = "💡 <strong>当前逻辑：</strong> ";
        if (so === 'total') text += "依据 <span style='color:#007bff'>总分</span> ";
        else if (so === 'single') text += "依据 <span style='color:#007bff'>单科成绩</span> ";
        else text += "依据 <span style='color:#007bff'>双科 T 分差值 (A-B)</span> ";

        if (st === 'balanced') text += "进行 <span style='color:#007bff'>S型蛇形分组</span>。<br>保证组间实力均衡，适合长期小组。";
        else if (st === 'high_low') text += "进行 <span style='color:#007bff'>首尾结对 (1帮1)</span>。<br>最强配最弱，适合专项帮扶。";
        else text += "进行 <span style='color:#007bff'>随机分组</span>。";

        if (so === 'complementary') {
            text += `<br>🔥 <strong>T分优势：</strong> 已消除学科难度差异。队首是“A强B弱”，队尾是“B强A弱”，1帮1结合后形成完美互补！`;
        }
        descBox.innerHTML = text;
    };

    strategySelect.addEventListener('change', updateUI);
    sortSelect.addEventListener('change', updateUI);
    updateUI(); // 初始运行一次

    // 生成按钮事件
    window.currentGroupsCache = []; // 初始化缓存
    
    document.getElementById('btn-generate-groups').addEventListener('click', () => {
        const className = document.getElementById('group-class-select').value;
        const strategy = strategySelect.value;
        const sortMode = sortSelect.value;
        const size = parseInt(document.getElementById('group-size-input').value) || 6;

        const params = {
            subject: document.getElementById('group-single-subject').value,
            subA: document.getElementById('group-sub-a').value,
            subB: document.getElementById('group-sub-b').value
        };

        // 1. 筛选班级
        let students = G_StudentsData.filter(s => s.class === className);
        if (students.length === 0) { alert("该班级无学生数据"); return; }

        // 确保 T 分已计算
        if (!G_StudentsData[0].tScores) {
            console.log("检测到 T 分缺失，正在计算全体标准分...");
            const globalStats = calculateAllStatistics(G_StudentsData);
            calculateStandardScores(G_StudentsData, globalStats);
        }

        // 2. 计算排序权重
        students.forEach(s => {
            if (sortMode === 'total') {
                s._sortScore = s.totalScore || 0;
                s._displayInfo = `总分: ${s.totalScore}`;
            } else if (sortMode === 'single') {
                s._sortScore = s.scores[params.subject] || 0;
                s._displayInfo = `${params.subject}: ${s.scores[params.subject]}`;
            } else if (sortMode === 'complementary') {
                // T 分差值
                const tA = (s.tScores && s.tScores[params.subA]) ? s.tScores[params.subA] : 50;
                const tB = (s.tScores && s.tScores[params.subB]) ? s.tScores[params.subB] : 50;
                const diff = tA - tB;
                
                s._sortScore = diff;
                // 显示原始分给老师看
                const rawA = s.scores[params.subA] || 0;
                const rawB = s.scores[params.subB] || 0;
                s._displayInfo = `${params.subA}:${rawA} / ${params.subB}:${rawB}`;
                s._compDiff = diff; 
            }
        });

        // 3. 排序 (降序)
        students.sort((a, b) => b._sortScore - a._sortScore);

        // 4. 执行分组
        // (假设 calculateGroups 函数已存在于 script.js 中)
        window.currentGroupsCache = calculateGroups(students, strategy, size, sortMode);

        // 5. 渲染
        // (假设 renderGroupVisuals 函数已存在于 script.js 中)
        renderGroupVisuals(window.currentGroupsCache, className, sortMode);

        // 6. 激活保存按钮
        const saveBtn = document.getElementById('btn-save-group-archive');
        if(saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "💾 保存当前分组";
        }
    });

    // 导出按钮事件
    document.getElementById('btn-export-groups').addEventListener('click', () => {
        if (window.currentGroupsCache.length > 0) exportGroupsToExcel(window.currentGroupsCache);
    });
}


// ==========================================
//  模块十六：AI 座位编排核心引擎
// ==========================================

// 全局变量：用于中断 AI 排座请求
let seatAIController = null;

/**
 * 16.9 [可停止版] AI 排座主入口
 * - 新增：AbortController 支持随时中断
 * - 优化：停止时 UI 状态复原
 */
async function generateAISeatingChart() {
    const apiKey = localStorage.getItem('G_DeepSeekKey');
    if (!apiKey) { alert("请先在【AI 智能分析】模块设置 DeepSeek API Key。"); return; }

    const className = document.getElementById('seat-class-select').value;
    const configStr = document.getElementById('seat-columns-config').value;
    const userPrompt = document.getElementById('seat-ai-prompt').value;
    const model = document.getElementById('seat-ai-model').value;

    // 1. 准备数据
    let students = G_StudentsData.filter(s => s.class === className);
    if (students.length === 0) { alert(`未找到 ${className} 的学生数据。`); return; }

    // 2. 数据打包
    const groupMap = {};
    if (window.currentGroupsCache) {
        window.currentGroupsCache.forEach((g, idx) => {
            g.members.forEach(m => groupMap[m.id] = `第${idx+1}组`);
        });
    }

    const studentList = students.map(s => {
        let phys = G_PhysicalData[s.id] || G_PhysicalData[s.name] || {};
        return {
            name: s.name,
            gender: phys.gender || '未知',
            height: parseFloat(phys.height) || '未知',
            group: groupMap[s.id] || '未分组'
        };
    });
    
    const totalCount = studentList.length;

    // 3. 构建 Prompt
    const systemPrompt = `你是一个排座算法。任务：将输入的 ${totalCount} 名学生全部分配到座位中。
【约束】：
1. 严禁 Markdown，只输 JSON。
2. 必须包含 EXACTLY ${totalCount} students。
3. JSON结构：[[{"size":N, "students":[...]}, ...], ...]
4. "students"含：name, gender, height, group。
5. 布局：[${configStr}]。`;

    const fullPrompt = `名单：${JSON.stringify(studentList)}\n要求：${userPrompt || "按身高从矮到高排。"}`;

    // 4. UI 初始化 (显示停止按钮)
    const loadingDiv = document.getElementById('seat-ai-loading');
    const resultArea = document.getElementById('seat-result-area');
    
    const startBtn = document.getElementById('btn-generate-ai-seats');
    const stopBtn = document.getElementById('btn-stop-ai-seat'); // [新增]
    
    const statusText = document.getElementById('seat-ai-status-text');
    const logContainer = document.getElementById('seat-ai-log-container');
    const reasoningEl = document.getElementById('seat-ai-reasoning');
    const contentEl = document.getElementById('seat-ai-content');

    // [状态切换]
    loadingDiv.style.display = 'block';
    resultArea.style.display = 'none';
    startBtn.style.display = 'none'; // 隐藏开始
    stopBtn.style.display = 'inline-block'; // 显示停止
    
    // 重置日志
    reasoningEl.innerHTML = '';
    contentEl.innerHTML = '';
    reasoningEl.style.display = 'none';
    statusText.innerText = model === 'deepseek-reasoner' ? "🧠 深度思考中..." : "🚀 正在规划布局...";

    let fullContent = "";
    
    // [核心] 初始化 AbortController
    if (seatAIController) seatAIController.abort(); // 防止重复点击
    seatAIController = new AbortController();

    // [绑定停止事件]
    stopBtn.onclick = () => {
        if (seatAIController) {
            seatAIController.abort(); // 中断请求
            seatAIController = null;
            
            // UI 反馈
            statusText.innerText = "🛑 用户已手动停止生成";
            statusText.style.color = "#dc3545";
            contentEl.innerHTML += `<br><br><em style="color:#dc3545;">[进程已终止]</em>`;
            
            // 恢复按钮
            stopBtn.style.display = 'none';
            startBtn.style.display = 'inline-block';
        }
    };

    try {
        // 5. 发起请求 (传入 signal)
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: fullPrompt }
                ],
                temperature: 0.7,
                stream: true 
            }),
            signal: seatAIController.signal // [关键] 绑定信号
        });

        if (!response.ok) throw new Error("API 请求失败");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('data: ')) {
                    const jsonStr = line.replace('data: ', '').trim();
                    if (jsonStr === '[DONE]') break;
                    try {
                        const json = JSON.parse(jsonStr);
                        const delta = json.choices[0].delta;
                        // 渲染思考
                        if (delta.reasoning_content) {
                            if (reasoningEl.style.display === 'none') {
                                reasoningEl.style.display = 'block';
                                reasoningEl.innerHTML = `<strong>[思维链]:</strong><br>`;
                            }
                            reasoningEl.innerText += delta.reasoning_content;
                            logContainer.scrollTop = logContainer.scrollHeight;
                        }
                        // 渲染内容
                        if (delta.content) {
                            if (delta.content && statusText.innerText.includes("思考")) {
                                statusText.innerText = "📝 正在绘制座位表...";
                                statusText.style.color = "#20c997";
                            }
                            fullContent += delta.content;
                            contentEl.innerText += delta.content;
                            logContainer.scrollTop = logContainer.scrollHeight;
                        }
                    } catch (e) {}
                }
            }
        }

        // 6. 解析与校验
        statusText.innerText = "✅ 生成完成，正在渲染...";
        
        let cleanJson = fullContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const firstBracket = cleanJson.indexOf('[');
        const lastBracket = cleanJson.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            cleanJson = cleanJson.substring(firstBracket, lastBracket + 1);
        }

        const seatMap = JSON.parse(cleanJson);
        
        let placedCount = 0;
        seatMap.forEach(row => {
            row.forEach(block => {
                if (block.students) {
                    block.students = block.students.map(s => {
                        if(s) placedCount++;
                        return s ? { 
                            ...s, 
                            _gender: s.gender, 
                            _height: parseFloat(s.height)||0,
                            _group: s.group || "未分组"
                        } : null;
                    });
                }
            });
        });

        G_CurrentSeatMap = seatMap;
        
        setTimeout(() => {
            loadingDiv.style.display = 'none';
            renderSeatingVisuals(seatMap);
            
            // 恢复按钮状态
            stopBtn.style.display = 'none';
            startBtn.style.display = 'inline-block';

            if (placedCount < totalCount) {
                alert(`⚠️ 警告：AI 只排了 ${placedCount}/${totalCount} 人。\n建议切换 R1 模型重试。`);
            }
        }, 800);

    } catch (err) {
        if (err.name === 'AbortError') {
            // 用户手动停止，前面 stopBtn.onclick 已经处理了 UI，这里无需弹窗
            console.log("用户终止了 AI 生成");
        } else {
            console.error(err);
            alert("AI 排座失败。\n" + err.message);
            loadingDiv.style.display = 'none';
            stopBtn.style.display = 'none';
            startBtn.style.display = 'inline-block';
        }
    } finally {
        seatAIController = null;
    }
}


// ==========================================
//  模块十三：AI 批量生成与打印系统
// ==========================================
/**
 * 打开批量配置窗口
 */
function openBatchModal() {
    const modal = document.getElementById('ai-batch-modal');
    const classSelect = document.getElementById('ai-batch-class');
    const modeDisplay = document.getElementById('ai-batch-mode-display');
    const mainModeSelect = document.getElementById('ai-mode-select');

    // 1. 填充班级
    const classes = [...new Set(G_StudentsData.map(s => s.class))].sort();
    classSelect.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');

    // 2. 同步当前模式
    const modeText = mainModeSelect.options[mainModeSelect.selectedIndex].text;
    modeDisplay.innerText = modeText;

    // 3. 重置 UI
    document.getElementById('ai-batch-config').style.display = 'block';
    document.getElementById('ai-batch-progress-area').style.display = 'none';
    
    modal.style.display = 'flex';
}

/**
 * [全局修复版] 执行批量分析
 */
async function runBatchAnalysis() {
    const apiKey = localStorage.getItem('G_DeepSeekKey');
    if (!apiKey) { alert("请先设置 API Key"); return; }

    const targetClass = document.getElementById('ai-batch-class').value;
    const mode = document.getElementById('ai-mode-select').value;
    const model = document.getElementById('ai-model-select').value;
    const grade = document.getElementById('ai-grade-select').value;
    const qCount = document.getElementById('ai-q-count').value;
    
    let targetSubject = document.getElementById('ai-item-subject').value;
    if (mode !== 'item_diagnosis' && mode !== 'teaching_guide') targetSubject = "";

    const checkboxes = document.querySelectorAll('.ai-batch-cb:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) { alert("请至少勾选一名学生！"); return; }

    const students = G_StudentsData.filter(s => selectedIds.includes(String(s.id)));

    if (!confirm(`即将生成 ${students.length} 份报告。\n确定开始吗？`)) return;

    // UI 切换
    document.getElementById('ai-batch-config').style.display = 'none';
    document.getElementById('ai-batch-progress-area').style.display = 'block';
    const logEl = document.getElementById('ai-batch-log');
    const barEl = document.getElementById('ai-batch-bar');
    const countEl = document.getElementById('ai-batch-count');
    const statusEl = document.getElementById('ai-batch-status');
    
    const saveBtn = document.getElementById('ai-batch-save-btn');
    const printBtn = document.getElementById('ai-batch-print-btn');
    const stopBtn = document.getElementById('ai-batch-stop-btn');

    // [核心] 重置全局变量
    window.G_BatchResults = [];
    window.stopBatchAI = false;

    logEl.innerHTML = '';
    saveBtn.disabled = true;
    printBtn.disabled = true;
    stopBtn.disabled = false;
    barEl.style.width = '0%';

    for (let i = 0; i < students.length; i++) {
        if (window.stopBatchAI) {
            logLog("🛑 用户已停止任务", "red");
            break;
        }

        const s = students[i];
        const progress = i + 1;
        countEl.innerText = `${progress}/${students.length}`;
        barEl.style.width = `${(progress / students.length) * 100}%`;
        statusEl.innerText = `正在生成: ${s.name}...`;

        try {
            const promptData = await generateAIPrompt(s.id, s.name, mode, qCount, grade, targetSubject, targetClass);
            const content = await fetchBatchAIResponse(apiKey, model, promptData);
            

            window.G_BatchResults.push({
                student: s,
                content: content,
                subject: targetSubject || "综合",
                mode: mode,
                grade: grade 
            });

            logLog(`✅ [${s.name}] 生成成功`, "green");

        } catch (err) {
            console.error(err);
            logLog(`❌ [${s.name}] 失败: ${err.message}`, "red");
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    statusEl.innerText = window.stopBatchAI ? "任务已终止" : "🎉 批量任务完成！";
    stopBtn.disabled = true;
    
    // 任务结束，启用保存按钮
    if (window.G_BatchResults.length > 0) {
        printBtn.disabled = false;
        printBtn.innerText = `🖨️ 批量打印 (${window.G_BatchResults.length})`;
        
        saveBtn.disabled = false;
        saveBtn.innerText = `💾 批量存档 (${window.G_BatchResults.length})`;
    }
}
// 辅助：批量专用的 API 调用 (无流式，直接返回文本)
async function fetchBatchAIResponse(apiKey, model, promptData) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: promptData.system },
                { role: "user", content: promptData.user }
            ],
            temperature: 0.7,
            stream: false // 批量模式下不使用流式，直接拿结果更稳
        })
    });

    if (!response.ok) throw new Error("API Error");
    const data = await response.json();
    return data.choices[0].message.content;
}

// 辅助：写日志
function logLog(msg, color = "#333") {
    const logEl = document.getElementById('ai-batch-log');
    const div = document.createElement('div');
    div.style.color = color;
    div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

/**
 * 批量打印逻辑
 */
function printBatchReports() {
    if (G_BatchResults.length === 0) return;
    
    const grade = document.getElementById('ai-grade-select').value;
    const modeEl = document.getElementById('ai-mode-select');
    const modeText = modeEl.options[modeEl.selectedIndex].text;

    let allHtml = "";

    G_BatchResults.forEach((item, index) => {
        // 渲染 Markdown
        const renderedContent = marked.parse(item.content);
        
        // 分页符 (第一个不需要)
        const pageBreak = index > 0 ? 'page-break-before: always;' : '';

        allHtml += `
            <div class="report-page" style="${pageBreak} padding: 2cm; position: relative;">
                <div class="print-header" style="text-align:center; border-bottom:2px solid #333; margin-bottom:20px; padding-bottom:10px;">
                    <h1 style="margin:0; font-size:24px;">学业分析报告 - ${item.student.name}</h1>
                    <p style="margin:5px 0 0; color:#666; font-size:14px;">
                        年级：${grade} | 科目：${item.subject} | 班级：${item.student.class}
                    </p>
                </div>
                
                <div class="report-body markdown-body" style="line-height:1.6; font-family:'Segoe UI', sans-serif;">
                    ${renderedContent}
                </div>
            </div>
        `;
    });

    // 打开打印窗口
    const win = window.open('', '_blank');
    win.document.write(`
        <html>
        <head>
            <title>批量分析报告</title>
            <style>
                body { background: #eee; margin: 0; font-family: sans-serif; }
                .report-page { background: white; width: 210mm; min-height: 297mm; margin: 20px auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); box-sizing: border-box; }
                
                /* 简易 Markdown 样式复刻 */
                h1, h2, h3 { color: #333; }
                strong { color: #000; background: #f0f0f0; padding: 0 4px; }
                ul { padding-left: 20px; }
                table { border-collapse: collapse; width: 100%; margin: 10px 0; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }

                @media print {
                    body { background: none; margin: 0; }
                    .report-page { width: auto; height: auto; margin: 0; box-shadow: none; border: none; }
                }
            </style>
        </head>
        <body>
            ${allHtml}
        </body>
        </html>
    `);
    win.document.close();
    
    // 等待图片等加载 (虽然这里主要是文本)
    setTimeout(() => {
        win.focus();
        win.print();
    }, 1000);
}


/**
 * 打开批量配置窗口
 */
function openBatchModal() {
    const modal = document.getElementById('ai-batch-modal');
    const classSelect = document.getElementById('ai-batch-class');
    const modeDisplay = document.getElementById('ai-batch-mode-display');
    const mainModeSelect = document.getElementById('ai-mode-select');

    // 1. 填充班级
    const classes = [...new Set(G_StudentsData.map(s => s.class))].sort();
    classSelect.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');

    // 2. 同步当前模式
    const modeText = mainModeSelect.options[mainModeSelect.selectedIndex].text;
    modeDisplay.innerText = modeText;

    // 3. [新增] 渲染默认选中班级的学生列表
    if (classes.length > 0) {
        renderBatchStudentList(classes[0]);
    }

    // 4. 重置 UI
    document.getElementById('ai-batch-config').style.display = 'block';
    document.getElementById('ai-batch-progress-area').style.display = 'none';
    modal.style.display = 'flex';
}

/**
 * [新增] 渲染学生复选框列表
 */
function renderBatchStudentList(className) {
    const container = document.getElementById('ai-batch-student-list');
    const countLabel = document.getElementById('ai-batch-selected-count');
    container.innerHTML = '';

    const students = G_StudentsData.filter(s => s.class === className);
    
    students.forEach(s => {
        const div = document.createElement('div');
        div.innerHTML = `
            <label style="cursor:pointer; font-size:0.9em; display:flex; align-items:center;">
                <input type="checkbox" value="${s.id}" checked class="ai-batch-cb" style="margin-right:5px;">
                ${s.name}
            </label>
        `;
        container.appendChild(div);
    });

    // 绑定点击更新计数
    const checkboxes = container.querySelectorAll('.ai-batch-cb');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const selected = container.querySelectorAll('.ai-batch-cb:checked').length;
            countLabel.innerText = `已选: ${selected} 人`;
        });
    });
    countLabel.innerText = `已选: ${students.length} 人`;
}

/**
 * [新增] 全选/反选
 */
function toggleBatchSelection(checked) {
    const checkboxes = document.querySelectorAll('.ai-batch-cb');
    checkboxes.forEach(cb => cb.checked = checked);
    const countLabel = document.getElementById('ai-batch-selected-count');
    countLabel.innerText = `已选: ${checked ? checkboxes.length : 0} 人`;
}


/**
 * [新增] 批量保存到历史记录
 */
function saveBatchToHistory() {
    // 1. 检查是否有结果
    if (!G_BatchResults || G_BatchResults.length === 0) {
        alert("当前没有可保存的生成结果！");
        return;
    }

    const btn = document.getElementById('ai-batch-save-btn');
    const originalText = btn.innerText;
    
    // 2. 视觉反馈
    btn.innerText = "⏳ 正在存档...";
    btn.disabled = true;

    // 获取模式文本
    const modeEl = document.getElementById('ai-mode-select');
    const modeText = modeEl.options[modeEl.selectedIndex].text;

    let savedCount = 0;

    // 3. 循环保存
    G_BatchResults.forEach(item => {
        // 转换 Markdown -> HTML
        // 注意：这里使用 item.content (AI返回的原始文本)
        const htmlContent = `<div class="ai-batch-saved markdown-body">${marked.parse(item.content)}</div>`;
        
        saveToAIHistory(
            `${item.student.name} - ${modeText}`,   // 标题
            `${item.grade} | ${item.subject} (批量)`, // 副标题
            null,                                   // ID
            htmlContent                             // 内容
        );
        savedCount++;
    });

    // 4. 完成提示
    setTimeout(() => {
        btn.innerText = `✅ 已存 ${savedCount} 条`;
        // 保持 disabled 状态防止重复点击刷屏
        
        // 刷新侧边栏 (如果侧边栏是打开的)
        if (typeof renderAIHistoryList === 'function') {
            renderAIHistoryList();
        }
        
        alert(`成功将 ${savedCount} 条分析报告保存到“历史记录”！\n\n您可以在侧边栏的“🕒 历史”中查看。`);
    }, 500);
}

// [辅助] 将搜索框逻辑提取出来，保持 initAIModule 整洁
async function initStudentSearchLogic() {
    const searchInput = document.getElementById('ai-student-search');
    const resultsContainer = document.getElementById('ai-student-search-results');
    const analyzeBtn = document.getElementById('ai-analyze-btn');

    const multiData = await loadMultiExamData();
    const allStudentsMap = new Map();
    multiData.forEach(exam => exam.students.forEach(s => allStudentsMap.set(s.id, s.name)));
    G_StudentsData.forEach(s => allStudentsMap.set(s.id, s.name));
    const allStudentsList = Array.from(allStudentsMap, ([id, name]) => ({ id, name }));

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        if (term.length < 1) { resultsContainer.style.display = 'none'; return; }
        const matches = allStudentsList.filter(s => s.name.toLowerCase().includes(term) || String(s.id).includes(term)).slice(0, 10);
        resultsContainer.innerHTML = matches.map(s => `<div class="result-item" data-id="${s.id}" data-name="${s.name}">${s.name} (${s.id})</div>`).join('');
        resultsContainer.style.display = 'block';
    });

    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item) {
            searchInput.value = `${item.dataset.name} (${item.dataset.id})`;
            searchInput.dataset.selectedId = item.dataset.id;
            searchInput.dataset.selectedName = item.dataset.name;
            resultsContainer.style.display = 'none';
            analyzeBtn.disabled = false;
        }
    });
}


// 1. 定义全局变量
window.G_BatchResults = []; 
window.stopBatchAI = false;

// ============================================================
//    🔥 霸道修复补丁：强制属性注入 (Inline Attribute Force)
// ============================================================

(function() {
    console.log("🛡️ [系统] 霸道修复模式已启动...");

    // 1. 定义一个绝对全局的保存函数 (挂载到 window 上)
    // 这样无论作用域怎么变，HTML 里的 onclick 都能找到它
    window.forceBatchSave = function(btnElement) {
        console.log("🖱️ [Click] 终于捕获到点击了！开始执行保存...");

        // --- 数据检查 ---
        if (!window.G_BatchResults || window.G_BatchResults.length === 0) {
            alert("❌ 内存中没有数据！\n请先点击【批量生成】，等待任务完成后再存档。");
            return;
        }

        // --- UI 反馈 ---
        const originalText = btnElement.innerText;
        btnElement.innerText = "⏳ 写入中...";
        btnElement.disabled = true;

        // --- 核心保存逻辑 ---
        setTimeout(() => {
            try {
                const AI_HISTORY_KEY = 'G_AI_History_Archive';
                let history = [];
                try { history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || "[]"); } catch(e) {}

                let savedCount = 0;
                // 获取当前模式名称
                let modeText = "AI分析";
                try { modeText = document.getElementById('ai-mode-select').selectedOptions[0].text; } catch(e) {}

                // 循环处理每一条
                window.G_BatchResults.forEach((item) => {
                    // 构建 Markdown 内容
                    let htmlContent = "";
                    if (typeof marked !== 'undefined') {
                        // 兼容不同版本的 marked
                        const parseFn = (typeof marked.parse === 'function') ? marked.parse : marked;
                        htmlContent = `<div class="ai-batch-saved markdown-body">${parseFn(item.content)}</div>`;
                    } else {
                        htmlContent = `<div class="ai-batch-saved"><pre>${item.content}</pre></div>`;
                    }

                    // 构建记录
                    history.unshift({
                        id: Date.now() + Math.random(),
                        timestamp: new Date().toLocaleString(),
                        title: `${item.student.name} - ${modeText}`,
                        subTitle: `${item.grade} | ${item.subject} (批量存档)`,
                        mainContent: htmlContent,
                        chatContent: ""
                    });
                    savedCount++;
                });

                // 写入存储
                localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(history));

                // 尝试刷新侧边栏 (如果函数存在)
                if (typeof renderAIHistoryList === 'function') renderAIHistoryList();

                alert(`🎉 存档成功！\n已将 ${savedCount} 条记录写入历史库。\n请点击侧边栏【🕒 历史】查看。`);

            } catch (err) {
                console.error("保存过程出错:", err);
                alert("❌ 保存出错: " + err.message);
            } finally {
                // 恢复按钮
                btnElement.innerText = originalText;
                btnElement.disabled = false;
            }
        }, 100); // 稍微延时，让UI先变一下
    };

    // 2. 启动“监工”定时器
    // 每 500毫秒 巡逻一次，确保按钮上一定有 onclick 属性
    setInterval(() => {
        const btn = document.getElementById('ai-batch-save-btn');
        
        // 只有当按钮存在，且没有被禁用（说明任务完成了）时，才进行强制绑定
        if (btn && !btn.disabled) {
            const currentAttr = btn.getAttribute('onclick');
            
            // 如果按钮上没有 onclick，或者 onclick 不是我们要的那个
            if (currentAttr !== 'window.forceBatchSave(this)') {
                // console.log("🔧 [Enforcer] 强制注入 onclick 属性...");
                // 1. 移除所有可能的干扰监听器 (通过克隆节点)
                // 注意：克隆会导致引用变化，如果主程序还在用旧引用更新UI可能会有问题
                // 所以这里我们只做属性覆盖，不克隆，这是最稳妥的
                
                // 2. 强制覆盖 onclick
                btn.setAttribute('onclick', 'window.forceBatchSave(this)');
                
                // 3. 确保样式是鼠标手型
                btn.style.cursor = 'pointer';
            }
        }
    }, 500);

})();