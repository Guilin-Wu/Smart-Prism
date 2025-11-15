/* eslint-disable no-undef */
'use strict';

// --- [新增] IndexedDB 配置 ---
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
// [!!] 关键：G_DynamicSubjectList 现在是唯一的科目来源，默认等于 DEFAULT_SUBJECT_LIST
let G_DynamicSubjectList = [...DEFAULT_SUBJECT_LIST];

// 存储数据
let G_StudentsData = []; // { id, name, class, totalScore, rank, gradeRank, scores: {...} }
let G_CompareData = [];  // 同上, 用于对比
//let G_MultiExamData = [];
let G_Statistics = {};   // 存储当前 *已筛选* 后的统计数据
let G_ItemAnalysisData = {};
let G_ItemAnalysisConfig = {};
let G_ItemOutlierList = [];
let G_ItemDetailSort = { key: 'deviation', direction: 'asc' }; // [!! NEW !!] 缓存学生详情表的排序状态
let G_CompareStatistics = {};
let G_TrendSort = { key: 'rank', direction: 'asc' }; // [!!] (新增) 趋势模块的排序状态
let currentAIController = null;
// 全局变量：存储 AI 对话历史
let G_AIChatHistory = [];

let G_CurrentHistoryId = null;

// 存储UI状态
let G_CurrentClassFilter = 'ALL';
let G_CurrentImportType = 'main';
let G_SubjectConfigs = {};

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

    // [!!] (新增) 导入模态框 DOM
    const importModal = document.getElementById('import-modal');
    const importModalTitle = document.getElementById('import-modal-title');
    const importModalCloseBtn = document.getElementById('import-modal-close-btn');
    const importModalSelect = document.getElementById('import-modal-select');
    const importModalFromFileBtn = document.getElementById('import-modal-from-file');
    const importModalFromStorageBtn = document.getElementById('import-modal-from-storage');
    const importMainBtn = document.getElementById('import-main-btn'); // (新按钮)
    const importCompareBtn = document.getElementById('import-compare-btn'); // (新按钮)
    const clearAllBtn = document.getElementById('clear-all-data-btn'); // [!!] (新增)



    // [!! NEW (Print Feature) !!]
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

    // 监听文件上传 (本次成绩) - [!!] (不变) 由模态框触发
    fileUploader.addEventListener('change', async (event) => {
        await handleFileData(event, 'main');
    });

    // 监听文件上传 (对比成绩) - [!!] (不变) 由模态框触发
    fileUploaderCompare.addEventListener('change', async (event) => {
        await handleFileData(event, 'compare');
    });

    // [!!] (新增) 打开导入模态框 (主)
    importMainBtn.addEventListener('click', () => {
        G_CurrentImportType = 'main';
        importModalTitle.innerText = '选择“本次成绩”数据源';
        openImportModal();
    });

    // [!!] (新增) 打开导入模态框 (对比)
    importCompareBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('disabled')) return;
        G_CurrentImportType = 'compare';
        importModalTitle.innerText = '选择“对比成绩”数据源';
        openImportModal();
    });

    // [!!] (新增) 导入模态框：关闭
    importModalCloseBtn.addEventListener('click', () => {
        importModal.style.display = 'none';
    });

    // [!!] (新增) 导入模态框：从文件
    importModalFromFileBtn.addEventListener('click', () => {
        if (G_CurrentImportType === 'main') {
            fileUploader.click();
        } else {
            fileUploaderCompare.click();
        }
        importModal.style.display = 'none';
    });

    // [!! 核心修复 !!] 导入模态框：从存储
    // 修复了数据仅写入 localStorage 而非 localforage (IndexedDB) 导致刷新丢失的问题
    importModalFromStorageBtn.addEventListener('click', async () => {
        const selectedId = importModalSelect.value;
        if (!selectedId) {
            alert('请选择一个已存的成绩单！');
            return;
        }

        // 1. 加载数据源
        const allData = await loadMultiExamData();
        const selectedExam = allData.find(e => String(e.id) === selectedId);

        if (!selectedExam) {
            alert('未找到所选数据，请刷新重试。');
            return;
        }

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

            // (B) 重建科目配置 (保留旧配置，添加新默认值)
            // [!!] 这里也需要改为从 localforage 读取，以防万一
            let storedConfigs = await localforage.getItem('G_SubjectConfigs');
            if (!storedConfigs) storedConfigs = {};

            G_SubjectConfigs = storedConfigs; // 更新内存

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

            // (C) [关键修复] 保存到 IndexedDB (localforage)
            // 之前是 localStorage，导致刷新后读取不到
            console.log("正在将导入数据写入 IndexedDB...");
            await localforage.setItem('G_StudentsData', G_StudentsData);
            await localforage.setItem('G_MainFileName', selectedExam.label);
            await localforage.setItem('G_SubjectConfigs', G_SubjectConfigs); // 保存更新后的配置

            // (D) UI 刷新
            populateClassFilter(G_StudentsData);
            welcomeScreen.style.display = 'none';
            document.getElementById('import-compare-btn').classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';

            if (importMainBtn) importMainBtn.innerHTML = labelText;

        } else {
            // --- 导入到【对比成绩】 ---
            G_CompareData = selectedExam.students;

            // [关键修复] 保存到 IndexedDB
            await localforage.setItem('G_CompareData', G_CompareData);
            await localforage.setItem('G_CompareFileName', selectedExam.label);

            const compareBtn = document.getElementById('import-compare-btn');
            if (compareBtn) compareBtn.innerHTML = labelText;
        }

        runAnalysisAndRender();
        importModal.style.display = 'none';
        alert(`成功导入：${selectedExam.label}`);
    });

    // [!!] (新增) 监听“清除所有数据”按钮


    // [!! NEW (Print Feature) !!] 打印模态框事件
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



    // [!! 核心修复 !!] “清除所有数据”按钮逻辑升级
    // 必须同时清除 localStorage (旧) 和 localforage (新数据库)
    clearAllBtn.addEventListener('click', async () => {
        if (confirm("⚠️ 高能预警\n\n您确定要清除所有已导入的“本次成绩”和“对比成绩”吗？\n此操作不可恢复！\n\n(注意：此操作【不会】清除“模块十二”中的历史存档)")) {

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

                // 3. 刷新页面
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

            // [!!] (修改) 先获取模块名
            const targetModule = link.getAttribute('data-module');

            // [!!] (修改) 如果不是“多次考试分析”模块，才检查 disabled
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
// [!! MODIFIED !!]
function initializeUI() {
    document.getElementById('import-compare-btn').classList.add('disabled');
    navLinks.forEach(link => {
        // [!!] (修改) 允许“多次考试分析”和“小题分析”模块始终可用
        const module = link.getAttribute('data-module');
        if (module === 'multi-exam' || module === 'item-analysis') { // [!! MODIFIED !!]
            link.classList.remove('disabled'); // 确保它绝不被禁用
        } else if (!link.classList.contains('active')) {
            link.classList.add('disabled');
        }
    });
}

/**
 * [终极稳定版] 文件处理函数 (包含写入验证)
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

        // 更新内存
        if (type === 'main') G_StudentsData = rankedData;
        else G_CompareData = rankedData;

        console.log(`正在保存 ${key} (${rankedData.length}条数据)...`);

        // [!! 核心修改 !!] 尝试直接保存
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

        // 5. UI 刷新逻辑
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
 * [!!] (重构) 
 * - 1. 表头定位器不再强制要求 "得分"，只查找 "姓名" 和 "班级"。
 * - 2. 列映射器现在支持 "一级表头" (例如, "语文" 列直接代表分数)。
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

                if (rawData.length < 2) { // (修改) 至少需要1行表头和1行数据
                    return reject(new Error("文件数据不完整，至少需要1行表头和1行数据。"));
                }

                // --- 🚀 智能定位表头行 (重构) ---
                let keyRowIndex = -1;
                // [!!] (修改) 我们只依赖 "姓名" 和 "班级"
                const REQUIRED_METRICS = ["姓名", "班级"];

                // 遍历原始数据的前几行（最多前5行）
                for (let i = 0; i < Math.min(rawData.length, 5); i++) {
                    const row = rawData[i].map(String).map(s => s.trim());
                    const foundCount = REQUIRED_METRICS.filter(metric => row.includes(metric)).length;

                    // [!!] (修改) 只要 "姓名" 和 "班级" 都在，就认定是关键行
                    if (foundCount === 2) {
                        keyRowIndex = i;
                        break;
                    }
                }

                if (keyRowIndex === -1) {
                    // [!!] (修改) 更新错误提示
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

                // [!!] (重构) 2. 核心：动态构建列映射 (colMap)
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
                        !["自定义考号", "姓名", "班级", "班次", "校次", "得分", "准考证号", "学生属性", "序号", "校次进退步", "班次进退步"].includes(key) && // [!!] (修改) 在这里添加 "准考证号"
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
                // [!!] (修改) 只要求 "name" 和 "class"
                const requiredKeys = ["name", "class"];
                const foundKeys = Object.values(colMap);
                const missingKeys = requiredKeys.filter(key => !foundKeys.includes(key));

                if (missingKeys.length > 0) {
                    // [!!] (修改) 更新错误提示
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
                            // [!!] (修改) 缺失的排名设为 null, 以便触发自动计算
                            student[key] = isNaN(cleanRank) ? null : cleanRank;
                        } else {
                            student[key] = String(rawValue || "").trim();
                        }
                    }

                    // [!!] (修改) 自动计算总分 (始终覆盖)
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

                    // [!!] (新增) ID回退
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
 * (重构) 6.2. 为数据添加单科排名
 * (总分排名 'rank' 和 'gradeRank' 已经从Excel读取)
 * @param {Array<Object>} studentsData
 * @returns {Array<Object>}
 */
function addSubjectRanksToData(studentsData) {
    const dataWithRanks = [...studentsData];
    const classes = [...new Set(dataWithRanks.map(s => s.class))]; // [!!] (新增) 获取所有班级

    // 1. 检查是否需要计算 年级总分排名 (gradeRank)
    // (如果第一个学生没有年排(是null或0), 假设所有学生都没有)
    if (!dataWithRanks[0].gradeRank) {
        // 按总分排序 (高到低)
        dataWithRanks.sort((a, b) => (b.totalScore || -Infinity) - (a.totalScore || -Infinity));
        // 赋予年级排名
        dataWithRanks.forEach((student, index) => {
            student.gradeRank = index + 1;
        });
    }

    // 2. 检查是否需要计算 班级总分排名 (rank)
    if (!dataWithRanks[0].rank) {
        classes.forEach(className => {
            // 筛选该班学生
            const classStudents = dataWithRanks.filter(s => s.class === className);
            // 按总分排序 (高到低)
            classStudents.sort((a, b) => (b.totalScore || -Infinity) - (a.totalScore || -Infinity));
            // 赋予班级排名
            classStudents.forEach((student, index) => {
                student.rank = index + 1;
            });
        });
    }

    G_DynamicSubjectList.forEach(subjectName => {

        // 1. [!!] (修改) 计算年级科目排名 (Grade Ranks)
        const sortedByGrade = [...dataWithRanks].sort((a, b) => {
            const scoreA = a.scores[subjectName] || -Infinity;
            const scoreB = b.scores[subjectName] || -Infinity;
            return scoreB - scoreA;
        });

        sortedByGrade.forEach((student, index) => {
            if (!student.gradeRanks) student.gradeRanks = {}; // [!!] (重命名)
            student.gradeRanks[subjectName] = index + 1;
        });

        // 2. [!!] (新增) 计算班级科目排名 (Class Ranks)
        classes.forEach(className => {
            // 筛选出该班学生
            const classStudents = dataWithRanks.filter(s => s.class === className);

            // 按分数排序
            const sortedByClass = [...classStudents].sort((a, b) => {
                const scoreA = a.scores[subjectName] || -Infinity;
                const scoreB = b.scores[subjectName] || -Infinity;
                return scoreB - scoreA;
            });

            // 附加班级排名
            sortedByClass.forEach((student, index) => {
                if (!student.classRanks) student.classRanks = {}; // [!!] (新属性)
                student.classRanks[subjectName] = index + 1;
            });
        });
    });

    // 按Excel中提供的 班级排名(rank) 排序后返回
    return dataWithRanks.sort((a, b) => a.rank - b.rank);
}


/**
 * (重构) 6.3. 计算所有统计数据
 * @param {Array<Object>} studentsData (这是 *已筛选* 后的数据)
 * @returns {Object}
 */
function calculateAllStatistics(studentsData) {
    if (!studentsData || studentsData.length === 0) return {};

    const stats = {};

    // 1. 统计所有科目 (从 G_SubjectConfigs 读取配置)
    // [!!] (新增) totalGood
    let totalFull = 0, totalPass = 0, totalExcel = 0, totalGood = 0;

    G_DynamicSubjectList.forEach(subjectName => {
        const config = G_SubjectConfigs[subjectName];
        if (!config) return; // 如果配置不存在，跳过

        const subjectScores = studentsData
            .map(s => s.scores[subjectName])
            .filter(score => typeof score === 'number' && !isNaN(score))
            .sort((a, b) => a - b);

        // [!!] (修改) 传入 config.good
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
        totalGood += config.good; // [!!] (新增)
    });

    // 2. 统计 '总分' (totalScore)
    const totalScores = studentsData.map(s => s.totalScore).filter(score => typeof score === 'number' && !isNaN(score)).sort((a, b) => a - b);
    // [!!] (修改) 传入 totalGood
    stats['totalScore'] = calculateStatsForScores(totalScores, totalFull, totalPass, totalExcel, totalGood);
    stats['totalScore'].name = '总分';

    return stats;
}


/**
 * [新增] 1. 计算标准分 (Z-Score / T-Score)
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
 * [新增] 2. 新高考赋分制预估 (简易版 - 21等级赋分)
 * 基于排位百分比映射到 100-30 分
 */
function calculateAssignedScore(rank, totalCount) {
    if (!totalCount) return 0;
    const percentage = (rank / totalCount) * 100;

    // 典型新高考赋分区间 (可根据省份政策调整)
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
 * [新增] 福建省新高考赋分算法 (3+1+2模式 - 再选科目)
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
 * (重构) 6.4. 辅助函数：计算单个分数数组的统计值
 * [!!] (修改) 增加了 superExcelLine (特优线) 和 lowLine (低分线) 参数
 */
function calculateStatsForScores(scores, fullMark, passLine, excellentLine, goodLine, superExcelLine, lowLine) {
    const count = scores.length;

    // [!!] 默认值保护：如果未定义，给一个默认值防止报错
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

    // [!!] (新增) 特优率 (Super Excellent)
    const countSuper = scores.filter(s => s >= superExcelLine).length;
    const superRate = (count > 0) ? (countSuper / count) * 100 : 0;

    // [!!] (新增) 低分率 (Low Score)
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

        // [!!] 新增返回指标
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
 * (新增) 7.1. 核心分析与渲染触发器
 * [!!] (已修改) 允许 multi-exam 模块在没有 G_StudentsData 时运行
 */
function runAnalysisAndRender() {
    // 1. [!!] (修改) 先获取当前要渲染的模块
    const currentModuleLink = document.querySelector('.nav-link.active');
    if (!currentModuleLink) return;
    const currentModule = currentModuleLink.dataset.module;

    // 2. [!!] (修改) 如果是“多次考试分析”或“小题分析”，则特殊处理
    if (currentModule === 'multi-exam') {
        renderModule(currentModule, [], []);
        return;
    }
    // [!! NEW !!]
    if (currentModule === 'item-analysis') {
        renderModule(currentModule, [], []);
        return;
    }

    // 3. [!!] (原第1行) 对所有其他模块，执行数据检查
    if (G_StudentsData.length === 0) {
        console.warn("runAnalysisAndRender: G_StudentsData 为空，已退出。");
        return;
    }

    // 4. (新增) 根据班级筛选
    const currentFilter = classFilterSelect.value;
    let activeData = G_StudentsData;
    let activeCompareData = G_CompareData;

    if (currentFilter !== 'ALL') {
        activeData = G_StudentsData.filter(s => s.class === currentFilter);

        if (G_CompareData.length > 0) {
            activeCompareData = G_CompareData.filter(s => s.class === currentFilter);
        }
    }

    // 5. (重构) 重新计算统计数据
    G_Statistics = calculateAllStatistics(activeData);
    calculateStandardScores(activeData, G_Statistics);
    if (activeCompareData.length > 0) {
        G_CompareStatistics = calculateAllStatistics(activeCompareData);

        calculateStandardScores(activeCompareData, G_CompareStatistics); // <-- 关键：这一行之前漏了
    }

    // 6. (重构) 渲染当前激活的模块
    // (currentModule 已在最前面获取)
    renderModule(currentModule, activeData, activeCompareData);
}

/**
 * (重构) 7.2. 模块渲染的“路由器”
 * [!!] 已新增 case 'weakness'
 */
function renderModule(moduleName, activeData, activeCompareData) {
    // [!!] (新增) 渲染任何模块时，都自动隐藏欢迎屏幕
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    modulePanels.forEach(p => p.style.display = 'none');
    const container = document.getElementById(`module-${moduleName}`);
    if (!container) return;
    container.style.display = 'block';

    // (重构) G_Statistics 已经是算好的
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

        // [!!] (新增) 3个新模块的路由
        case 'boundary':
            renderBoundary(container, activeData, G_Statistics);
            break;
        case 'holistic':
            renderHolisticBalance(container, activeData, G_Statistics);
            break;
        case 'trend-distribution':
            renderTrendDistribution(container, activeData, activeCompareData, G_Statistics, G_CompareStatistics, G_CurrentClassFilter); // [!!] (新增) 传入 G_CurrentClassFilter
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
        // [!!] (新增) 偏科诊断
        case 'weakness':
            renderWeakness(container, activeData, G_Statistics); // [!!] (新增) 传入 G_Statistics
            break;
        //小题分析
        case 'item-analysis':
            renderItemAnalysis(container);
            break;

        case 'ai-advisor':
            // [!! 修复 !!] 每次进入 AI 模块时，强制刷新一下 UI
            // 这样你在模块 13 刚导入的数据，这里也能立马看到了
            const aiModeSelect = document.getElementById('ai-mode-select');
            if (aiModeSelect) {
                // 模拟用户“切换”了一次模式，触发数据重新加载
                aiModeSelect.dispatchEvent(new Event('change'));
            }
            break;

        case 'goal-setting':
            renderGoalSetting(container, activeData, G_Statistics);
            break;

        default:
            container.innerHTML = `<h2>模块 ${moduleName} (待开发)</h2>`;
    }
}

/**
 * (新增) 7.3. 填充班级筛选
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
 * (新增) 8.1. 初始化 G_SubjectConfigs
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
            isAssigned: false // [!! 新增 !!] 默认为不赋分
        };
    });
}

/**
 * (新增) 8.2. 用 G_SubjectConfigs 填充模态窗口 (修复版：自动补全默认值)
 */


/**
 * (新增) 8.2. 用 G_SubjectConfigs 填充模态窗口
 * [!! 修正版 3 !!] 增加“是否赋分”列
 */
function populateSubjectConfigModal() {
    let html = '';
    G_DynamicSubjectList.forEach(subject => {
        const config = G_SubjectConfigs[subject];

        const valSuper = config.superExcel !== undefined ? config.superExcel : (config.full * 0.9);
        const valLow = config.low !== undefined ? config.low : (config.full * 0.3);

        // [!! 新增 !!] 读取是否赋分 (默认 false)
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
 * (新增) 8.3. 从模态窗口保存配置
 * [!! 终极修复版 !!] 专门处理 Checkbox 的保存逻辑
 */
function saveSubjectConfigsFromModal() {
    // 获取表格里所有的 input 标签
    const inputs = subjectConfigTableBody.querySelectorAll('input');

    inputs.forEach(input => {
        const subject = input.dataset.subject;
        const type = input.dataset.type; // 例如 'full', 'excel', 'isAssigned'

        // 确保配置对象存在
        if (!G_SubjectConfigs[subject]) {
            G_SubjectConfigs[subject] = {};
        }

        // [!! 核心差异在这里 !!]
        if (input.type === 'checkbox') {
            // 如果是勾选框，我们要存的是 true/false (checked属性)
            G_SubjectConfigs[subject][type] = input.checked;
            console.log(`更新 ${subject} 的赋分状态: ${input.checked}`); // 调试日志
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
 * 9.1. 模块一：班级整体分析 (已重构为 2x2 网格，新增班级对比)
 * [!!] drawHistogram 已修改，以支持新版 renderHistogram
 */
function renderDashboard(container, stats, activeData) {
    const totalStats = stats.totalScore || {};

    // [!!] (核心修改) 计算总人数、参考人数、缺考人数
    const totalStudentCount = activeData.length; // (总人数 = 筛选器内的所有学生)
    const participantCount = totalStats.count || 0; // (考试人数 = 有总分的学生)
    const missingCount = totalStudentCount - participantCount; // (缺考人数)

    // 1. 渲染 KPI 卡片 (已修改)
    container.innerHTML = `
        <h2>模块一：班级整体分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="kpi-grid">
            <div class="kpi-card"><h3>总人数</h3><div class="value">${totalStudentCount}</div></div>
            <div class="kpi-card"><h3>考试人数</h3><div class="value">${participantCount}</div></div>
            <div class="kpi-card"><h3>缺考人数</h3><div class="value">${missingCount}</div></div>
            <div class="kpi-card"><h3>总分平均分</h3><div class="value">${totalStats.average || 0}</div></div>
            <div class="kpi-card"><h3>总分最高分</h3><div class="value">${totalStats.max || 0}</div></div>
            <div class="kpi-card"><h3>总分最低分</h3><div class="value">${totalStats.min || 0}</div></div>
            <div class="kpi-card"><h3>总分中位数</h3><div class="value">${totalStats.median || 0}</div></div>
            <div class="kpi-card"><h3>总分优秀率 (%)</h3><div class="value">${totalStats.excellentRate || 0}</div></div>
            <div class="kpi-card"><h3>总分良好率 (%)</h3><div class="value">${totalStats.goodRate || 0}</div></div>
            <div class="kpi-card"><h3>总分及格率 (%)</h3><div class="value">${totalStats.passRate || 0}</div></div>
            <div class="kpi-card"><h3>总分不及格率 (%)</h3><div class="value">${totalStats.failRate || 0}</div></div>
            <div class="kpi-card"><h3>总分标准差</h3><div class="value">${totalStats.stdDev || 0}</div></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h3>全科统计表</h3>
            <div class="table-container" style="max-height: 400px;">
                <table>
                    <thead>
                        <tr>
                            <th>科目</th>
                            <th>考试人数</th>
                            <th>平均分</th>
                            <th>最高分</th>
                            <th>中位数</th>
                            <th>优秀率 (%)</th>
                            <th>良好率 (%)</th> 
                            <th>及格率 (%)</th>
                            <th>标准差</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-score-row">
                            <td><strong>${stats.totalScore.name}</strong></td>
                            <td>${stats.totalScore.count}</td>
                            <td>${stats.totalScore.average}</td>
                            <td>${stats.totalScore.max}</td>
                            <td>${stats.totalScore.median}</td>
                            <td>${stats.totalScore.excellentRate}</td>
                            <td>${stats.totalScore.goodRate || 0}</td> 
                            <td>${stats.totalScore.passRate}</td>
                            <td>${stats.totalScore.stdDev || 0}</td>
                        </tr>
                        ${G_DynamicSubjectList.map(subject => stats[subject]).filter(s => s).map(s => `
                            <tr>
                                <td><strong>${s.name}</strong></td>
                                <td>${s.count}</td>
                                <td>${s.average}</td>
                                <td>${s.max}</td>
                                <td>${s.median}</td>
                                <td>${s.excellentRate}</td>
                                <td>${s.goodRate || 0}</td> 
                                <td>${s.passRate}</td>
                                <td>${s.stdDev || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="dashboard-chart-grid-2x2">
            
            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <h4 style="margin:0;">全科分数分布箱形图</h4>
                </div>
                <div class="chart-container" id="subject-boxplot-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                 <div class="controls-bar chart-controls">
                    <label for="class-compare-subject">科目:</label>
                    <select id="class-compare-subject" class="sidebar-select" style="min-width: 100px;">
                        <option value="totalScore">总分</option>
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <label for="class-compare-metric">指标:</label>
                    <select id="class-compare-metric" class="sidebar-select" style="min-width: 120px;">
                        <option value="average">平均分</option>
                        <option value="passRate">及格率 (%)</option>
                        <option value="stdDev">标准差</option>
                        <option value="max">最高分</option>
                        <option value="median">中位数</option>
                    </select>
                </div>
                <div class="chart-container" id="class-compare-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="chart-container" id="radar-chart" style="height: 400px;"></div>
            </div>

            <div class="main-card-wrapper">
                 <div class="controls-bar chart-controls">
                    <label for="histogram-bin-size">分段大小:</label>
                    <input type="number" id="histogram-bin-size" value="30" style="width: 60px;">
                    <button id="histogram-redraw-btn" class="sidebar-button" style="width: auto;">重绘</button>
                </div>
                <div class="chart-container" id="histogram-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <label for="scatter-x-subject">X轴:</label>
                    <select id="scatter-x-subject" class="sidebar-select">
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <label for="scatter-y-subject">Y轴:</label>
                    <select id="scatter-y-subject" class="sidebar-select">
                        ${G_DynamicSubjectList.map((s, i) => `<option value="${s}" ${i === 1 ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
                <div class="chart-container" id="correlation-scatter-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <h4 style="margin:0;">各科 A/B/C/D 构成 (百分比)</h4>
                </div>
                <div class="chart-container" id="stacked-bar-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper" style="grid-column: span 2;"> <div class="controls-bar chart-controls">
                    <h4 style="margin:0;">各科对总分差距的贡献度分析 (Contribution)</h4>
                    <span style="font-size: 0.8em; color: var(--text-muted);">(正值表示该科均分高于年级，拉高了总分；负值表示拉低了总分)</span>
                  </div>
                 <div class="chart-container" id="contribution-chart" style="height: 400px;"></div>
            </div>

        </div>
    `;

    // 4. 渲染图表
    const drawHistogram = () => {
        // [!!] 核心修改
        if (totalStats.scores && totalStats.scores.length > 0) {
            const fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
            const binSize = parseInt(document.getElementById('histogram-bin-size').value) || 30;
            renderHistogram(
                'histogram-chart',
                activeData,     // [!!] 传入完整学生数据
                'totalScore',   // [!!] 告知函数使用哪个分数key
                fullScore,
                `总分分数段直方图 (分段=${binSize})`,
                binSize
            );
        }
    };

    // 5. (新增) 班级对比图的事件
    const classSubjectSelect = document.getElementById('class-compare-subject');
    const classMetricSelect = document.getElementById('class-compare-metric');

    const drawClassCompareChart = () => {
        const subject = classSubjectSelect.value;
        const metric = classMetricSelect.value;
        if (G_CurrentClassFilter === 'ALL') {
            const data = calculateClassComparison(metric, subject);
            let subjectName = subject === 'totalScore' ? '总分' : subject;
            let metricName = classMetricSelect.options[classMetricSelect.selectedIndex].text;
            renderClassComparisonChart('class-compare-chart', data, `各班级 - ${subjectName} ${metricName} 对比`);
        } else {
            document.getElementById('class-compare-chart').innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">请在侧边栏选择 "全体年段" 以查看班级对比。</p>`;
        }
    };

    // (新增) 散点图的事件
    const scatterXSelect = document.getElementById('scatter-x-subject');
    const scatterYSelect = document.getElementById('scatter-y-subject');

    const drawScatterPlot = () => {
        const xSubject = scatterXSelect.value;
        const ySubject = scatterYSelect.value;
        renderCorrelationScatterPlot('correlation-scatter-chart', activeData, xSubject, ySubject);
    };


    // [!! 新增 !!] 绘制贡献度图表
    const drawContributionChart = () => {
        if (G_CurrentClassFilter === 'ALL') {
            document.getElementById('contribution-chart').innerHTML =
                `<p style="text-align:center; padding-top:50px; color:#999;">请选择具体班级以查看贡献度分析。</p>`;
            return;
        }

        // 计算贡献度： (班级均分 - 年级均分)
        // 注意：这里需要重新计算一下"年级"的统计数据作为基准
        // 简单起见，如果当前 G_Statistics 是班级的，我们需要全校数据。
        // 比较好的做法是：runAnalysisAndRender 里应该始终保留一份 G_GlobalStatistics (全校)。

        // 这里做一个临时计算全校均分的补丁：
        const globalStats = calculateAllStatistics(G_StudentsData); // 计算全校数据

        const subjects = G_DynamicSubjectList;
        const contributionData = subjects.map(sub => {
            const classAvg = stats[sub] ? stats[sub].average : 0;
            const gradeAvg = globalStats[sub] ? globalStats[sub].average : 0;
            return parseFloat((classAvg - gradeAvg).toFixed(2));
        });

        // 计算总分差距
        const totalDiff = contributionData.reduce((a, b) => a + b, 0).toFixed(2);

        renderContributionChart('contribution-chart', subjects, contributionData, totalDiff);
    };

    drawContributionChart(); // 调用绘图

    // 6. 绑定事件
    document.getElementById('histogram-redraw-btn').addEventListener('click', drawHistogram);
    scatterXSelect.addEventListener('change', drawScatterPlot);
    scatterYSelect.addEventListener('change', drawScatterPlot);
    classSubjectSelect.addEventListener('change', drawClassCompareChart);
    classMetricSelect.addEventListener('change', drawClassCompareChart);

    // 7. 初始绘制
    drawHistogram();
    drawClassCompareChart();
    renderAverageRadar('radar-chart', stats);
    renderSubjectBoxPlot('subject-boxplot-chart', G_Statistics, activeData); // [!!] (新增) 传入 activeData
    renderStackedBar('stacked-bar-chart', G_Statistics, G_SubjectConfigs);
    drawScatterPlot();
}

/**
 * 9.2. 模块二：学生个体报告 (已集成“进退步”对比)
 * * [!! 修正版 18 !!] - 2025-11-12
 * - (Feature) 新增“打印报告”按钮和模态框触发器。
 */
function renderStudent(container, students, stats) {

    // 1. (重写) 渲染搜索框 和 结果容器
    container.innerHTML = `
        <h2>模块二：学生个体报告 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="controls-bar">
            <label for="student-search">搜索学生 (姓名/考号):</label>
            <div class="search-combobox">
                <input type="text" id="student-search" placeholder="输入姓名或考号..." autocomplete="off">
                <div class="search-results" id="student-search-results"></div>
            </div>
            
            <button id="open-print-modal-btn" class="sidebar-button" style="margin-left: auto; background-color: var(--color-blue);">
                🖨️ 打印报告
            </button>
        </div>
        <div id="student-report-content">
            <p>请输入关键词以搜索学生。</p>
        </div>
    `;

    // 2. (重写) 绑定新搜索框的事件
    const searchInput = document.getElementById('student-search');
    const resultsContainer = document.getElementById('student-search-results');
    const contentEl = document.getElementById('student-report-content');

    // [!! NEW (Print Feature) !!] 绑定打印按钮
    const openPrintModalBtn = document.getElementById('open-print-modal-btn');
    const printModal = document.getElementById('print-modal');
    const printBtnCurrent = document.getElementById('print-btn-current');
    const printBtnFilter = document.getElementById('print-btn-filter');

    openPrintModalBtn.addEventListener('click', () => {
        // 1. 更新“打印当前学生”按钮的状态
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

        // 2. 更新“打印筛选”按钮的状态
        const filterText = (G_CurrentClassFilter === 'ALL') ? '全体年段' : G_CurrentClassFilter;
        printBtnFilter.innerHTML = `🖨️ 打印当前筛选 (${filterText})`;

        // 3. 打开模态框
        printModal.style.display = 'flex';
    });


    // 这是一个辅助函数，用于显示学生的详细报告
    const showReport = (studentId) => {
        const student = students.find(s => String(s.id) === String(studentId));
        if (!student) {
            contentEl.innerHTML = `<p>未找到学生。</p>`;
            return;
        }

        // [!! NEW (Print Feature) !!] 存储当前学生信息，以便打印
        contentEl.dataset.currentStudentId = student.id;
        contentEl.dataset.currentStudentName = student.name;

        // ======================================================
        // ▼▼▼ (核心修改) 查找对比数据并计算进退步 ▼▼▼
        // ======================================================
        let oldStudent = null;
        let scoreDiff = 'N/A', rankDiff = 'N/A', gradeRankDiff = 'N/A';

        // 检查 G_CompareData 是否存在
        if (G_CompareData && G_CompareData.length > 0) {
            oldStudent = G_CompareData.find(s => String(s.id) === String(student.id));
        }

        if (oldStudent) {
            scoreDiff = (student.totalScore - oldStudent.totalScore).toFixed(2);
            rankDiff = oldStudent.rank - student.rank; // 排名：旧-新，正数为进步
            gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 'N/A';
        }
        // 1. 在 map 循环之前，获取年级总人数 (用于计算赋分)
        const totalStudentCount = G_StudentsData.length;
        // [!!] (美化) 核心修改点：在 student-card 的 div 上添加了 sc-xxx 类
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
                    <span>班级排名 (上次: ${oldStudent ? oldStudent.rank : 'N/A'})</span>
                    <strong class="${rankDiff > 0 ? 'progress' : rankDiff < 0 ? 'regress' : ''}">
                        ${student.rank}
                        ${(rankDiff !== 'N/A' && oldStudent) ? `(${rankDiff > 0 ? '▲' : '▼'} ${Math.abs(rankDiff)})` : ''}
                    </strong>
                </div>

                <div class="sc-grade-rank">
                    <span>年级排名 (上次: ${oldStudent ? (oldStudent.gradeRank || 'N/A') : 'N/A'})</span>
                    <strong class="${gradeRankDiff > 0 ? 'progress' : gradeRankDiff < 0 ? 'regress' : ''}">
                        ${student.gradeRank || 'N/A'}
                        ${(gradeRankDiff !== 'N/A' && oldStudent) ? `(${gradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(gradeRankDiff)})` : ''}
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

            // 1. 计算原始分/排名的进退步
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

            // 2. 计算赋分 (保持不变)
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

            // 3. [!! 核心修复 !!] 获取本次 T 分 & 计算 T 分变化
            const tScore = (student.tScores && student.tScores[subject]) ? student.tScores[subject] : 'N/A';
            let tScoreDiffHtml = '';

            // 尝试获取上次 T 分
            if (oldStudent && oldStudent.tScores && oldStudent.tScores[subject]) {
                const oldTScore = oldStudent.tScores[subject];
                if (tScore !== 'N/A') {
                    const diff = tScore - oldTScore;
                    const diffAbs = Math.abs(diff).toFixed(1);
                    // 根据正负生成箭头
                    if (diff > 0) {
                        tScoreDiffHtml = `<span class="progress" style="font-size:0.9em; margin-left:4px;">(▲${diffAbs})</span>`;
                    } else if (diff < 0) {
                        tScoreDiffHtml = `<span class="regress" style="font-size:0.9em; margin-left:4px;">(▼${diffAbs})</span>`;
                    }
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
                ${student.classRanks ? (student.classRanks[subject] || 'N/A') : 'N/A'}
                ${(oldStudent && subjectClassRankDiff !== 'N/A') ? `<span class="${subjectClassRankDiff > 0 ? 'progress' : subjectClassRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectClassRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectClassRankDiff)})</span>` : ''}
            </td>
            <td>
                <div>
                    ${student.gradeRanks ? (student.gradeRanks[subject] || 'N/A') : 'N/A'}
                    ${(oldStudent && subjectGradeRankDiff !== 'N/A') ? `<span class="${subjectGradeRankDiff > 0 ? 'progress' : subjectGradeRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectGradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectGradeRankDiff)})</span>` : ''}
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

        // (不变) 渲染雷达图
        renderStudentRadar('student-radar-chart', student, stats);
    };

    // 3. (不变) 监听搜索框的输入事件
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
                    <strong>${s.name}</strong> (${s.id}) - 班排: ${s.rank}
                </div>`;
            }).join('');
        }
        resultsContainer.style.display = 'block';
    });

    // 4. (不变) 监听下拉选项的点击事件
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

    // 5. (不变) 当用户点击页面其他地方时，隐藏下拉菜单
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    // 6. (不变) 当用户重新聚焦搜索框时，如果已有结果则显示
    searchInput.addEventListener('focus', () => {
        if (resultsContainer.innerHTML !== '') {
            resultsContainer.style.display = 'block';
        }
    });
}

/**
 * 9.3. 模块三：试卷科目分析
 * [!!] 已修改：签名增加 activeData, drawChart 传递 activeData
 */
function renderPaper(container, stats, activeData) {
    // 1. (重构) 渲染 1x4 垂直布局
    container.innerHTML = `
        <h2>模块三：试卷科目分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="subject-select">选择科目:</label>
                <select id="subject-select" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                
                <label for="paper-bin-size">分段大小:</label>
                <input type="number" id="paper-bin-size" value="10" style="width: 60px;">
                <button id="paper-redraw-btn" class="sidebar-button" style="width: auto;">重绘</button>
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

    // 2. (重构) 绘制直方图
    const drawChart = () => {
        // [!!] 核心修改
        const subjectName = document.getElementById('subject-select').value;
        const binSize = parseInt(document.getElementById('paper-bin-size').value) || 10;
        const s = stats[subjectName];
        if (!s) return;

        let fullScore;
        if (subjectName === 'totalScore') {
            fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
        } else {
            fullScore = G_SubjectConfigs[subjectName]?.full || 100;
        }

        renderHistogram(
            'subject-histogram-chart',
            activeData,     // [!!] 传入完整学生数据
            subjectName,    // [!!] 告知函数使用哪个分数key
            fullScore,
            `${s.name} 分数段直方图 (均分: ${s.average}, 分段=${binSize})`,
            binSize
        );
    };

    // 3. (重构) 绑定事件 (不变)
    document.getElementById('subject-select').addEventListener('change', drawChart);
    document.getElementById('paper-redraw-btn').addEventListener('click', drawChart);

    // 4. (新增) 绘制新图表
    renderSubjectComparisonBarChart('difficulty-chart', stats, 'difficulty');
    renderSubjectComparisonBarChart('discrimination-chart', stats, 'stdDev');
    renderDifficultyScatter('difficulty-scatter-chart', stats);

    // 5. 默认绘制总分
    drawChart('totalScore');
}


/**
 * (新增) 9.3.5. 模块：单科成绩分析
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

        <div id="ss-kpi-grid" class="kpi-grid" style="margin-bottom: 20px;">
            </div>

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

            <div class="main-card-wrapper">
                <h4 style="margin:0;">A/B/C/D 等级构成</h4>
                <div class="chart-container" id="ss-abcd-pie-chart" style="height: 400px;"></div>
            </div>

            <div class="main-card-wrapper">
                <h4 style="margin:0;">本科目 Top 10</h4>
                <div class="table-container" id="ss-top10-table" style="max-height: 400px;"></div>
            </div>
            <div class="main-card-wrapper">
                <h4 style="margin:0;">本科目 Bottom 10</h4>
                <div class="table-container" id="ss-bottom10-table" style="max-height: 400px;"></div>
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

        // 2.3 [!!] (新) 渲染班级对比图
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


        // 2.4 [!!] (新) 渲染饼图
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
                    <thead><tr><th>${rankHeader}</th><th>姓名</th><th>分数</th><th>班排</th></tr></thead>
                    <tbody>
                        ${data.map((s, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${s.name}</td>
                                <td><strong>${s.scores[subjectName]}</strong></td>
                                <td>${s.rank}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        };

        document.getElementById('ss-top10-table').innerHTML = createTable(top10, 'top');
        document.getElementById('ss-bottom10-table').innerHTML = createTable(bottom10, 'bottom');
    };

    // 3. 绑定主事件
    document.getElementById('ss-subject-select').addEventListener('change', drawAnalysis);

    // 4. 初始绘制 (默认使用列表中的第一个科目)
    drawAnalysis();
}

/**
 * 9.4. 模块四：成绩趋势对比
 * [!!] 已修改：删除 "进退步一览" 图，布局变为 1x1
 * [!!] (已合并) "年排" 列, "姓名/考号" 排序, "学生进退步条形图"
 */
function renderTrend(container, currentData, compareData) {

    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块十一：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2><p>请先在侧边栏导入 "对比成绩" 数据。</p>`;
        return;
    }

    // 1. (核心) 匹配两个数据源 (不变)
    const mergedData = currentData.map(student => {
        const oldStudent = compareData.find(s => String(s.id) === String(student.id));

        if (!oldStudent) {
            return {
                ...student,
                oldTotalScore: null, oldRank: null, oldGradeRank: null,
                scoreDiff: 0, rankDiff: 0, gradeRankDiff: 0
            };
        }

        const scoreDiff = student.totalScore - oldStudent.totalScore;
        const rankDiff = oldStudent.rank - student.rank;
        const gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 0;

        return {
            ...student,
            oldTotalScore: oldStudent.totalScore,
            oldRank: oldStudent.rank,
            oldGradeRank: oldStudent.gradeRank || null,
            scoreDiff: parseFloat(scoreDiff.toFixed(2)),
            rankDiff: rankDiff,
            gradeRankDiff: gradeRankDiff
        };
    });

    // 2. (新增) 这是一个辅助函数，用于根据数据生成表格行 (不变)
    const renderTableRows = (dataToRender) => {
        return dataToRender.map(s => `
            <tr>
               <td>${s.id}</td>
                <td>${s.name}</td>
                <td><strong>${s.totalScore}</strong> (上次: ${s.oldTotalScore ?? 'N/A'})</td>
                <td class="${s.scoreDiff > 0 ? 'progress' : s.scoreDiff < 0 ? 'regress' : ''}">
                    ${s.scoreDiff > 0 ? '▲' : s.scoreDiff < 0 ? '▼' : ''} ${Math.abs(s.scoreDiff)}
                </td>
                <td><strong>${s.rank}</strong></td>
                <td class="${s.rankDiff > 0 ? 'progress' : s.rankDiff < 0 ? 'regress' : ''}">
                    ${s.rankDiff > 0 ? '▲' : s.rankDiff < 0 ? '▼' : ''} ${Math.abs(s.rankDiff)} (上次: ${s.oldRank ?? 'N/A'})
                </td>
                <td>${s.gradeRank ?? 'N/A'}</td>
                <td class="${s.gradeRankDiff > 0 ? 'progress' : s.gradeRankDiff < 0 ? 'regress' : ''}">
                    ${s.gradeRankDiff > 0 ? '▲' : s.gradeRankDiff < 0 ? '▼' : ''} ${Math.abs(s.gradeRankDiff)} (上次: ${s.oldGradeRank ?? 'N/A'})
                </td>
            </tr>
        `).join('');
    };

    // 3. (新增) 核心：排序和渲染表格的函数 (不变)
    const drawTable = () => {
        const searchTerm = document.getElementById('trend-search').value.toLowerCase();

        const filteredData = mergedData.filter(s => {
            return String(s.name).toLowerCase().includes(searchTerm) ||
                String(s.id).toLowerCase().includes(searchTerm);
        });

        const { key, direction } = G_TrendSort;
        filteredData.sort((a, b) => {
            let valA = a[key];
            let valB = b[key];
            valA = (valA === null || valA === undefined) ? (direction === 'asc' ? Infinity : -Infinity) : valA;
            valB = (valB === null || valB === undefined) ? (direction === 'asc' ? Infinity : -Infinity) : valB;

            if (typeof valA === 'string' || typeof valB === 'string') {
                valA = String(valA);
                valB = String(valB);
                return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return direction === 'asc' ? valA - valB : valB - valA;
            }
        });

        document.getElementById('trend-table-body').innerHTML = renderTableRows(filteredData);

        document.querySelectorAll('#trend-table-header th[data-sort-key]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sortKey === key) {
                th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    };

    // 4. (新增) 绘制图表的函数
    const drawCharts = () => {
        const classFilter = document.getElementById('trend-class-filter').value;
        const sortFilter = document.getElementById('trend-sort-filter').value; // [!!] (新增) 获取排序值

        const scatterData = (classFilter === 'ALL')
            ? mergedData
            : mergedData.filter(s => s.class === classFilter);

        // [!!] (修改) 传入排序参数
        renderRankChangeBarChart('trend-rank-change-bar-chart', scatterData, sortFilter);
    };

    // 5. (重构) 渲染基础HTML
    container.innerHTML = `
        <h2>模块十一：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div class="controls-bar chart-controls">
                    <label for="trend-class-filter">班级:</label>
                    <select id="trend-class-filter" class="sidebar-select" style="min-width: 120px;">
                        <option value="ALL">-- 全体年段 --</option>
                        ${[...new Set(currentData.map(s => s.class))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>

                    <label for="trend-sort-filter">排序:</label>
                    <select id="trend-sort-filter" class="sidebar-select" style="min-width: 150px;">
                        <option value="name">按学生姓名 (默认)</option>
                        <option value="rankDiff_desc">按班排变化 (进步最多)</option>
                        <option value="rankDiff_asc">按班排变化 (退步最多)</option>
                        <option value="gradeRankDiff_desc">按年排变化 (进步最多)</option>
                        <option value="gradeRankDiff_asc">按年排变化 (退步最多)</option>
                    </select>
                </div>
            <div class="chart-container" id="trend-rank-change-bar-chart" style="height: 350px;"></div>
        </div>
        <div class="main-card-wrapper">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0 0 15px 0;">
                <label for="trend-search">搜索学生:</label>
                <input type="text" id="trend-search" placeholder="输入姓名或考号...">
            </div>

            <div class="table-container">
                <table>
                    <thead id="trend-table-header">
                        <tr>
                             <th data-sort-key="id">考号</th>
                            <th data-sort-key="name">姓名</th>
                            <th data-sort-key="totalScore">总分</th>
                            <th data-sort-key="scoreDiff">分数变化</th>
                            <th data-sort-key="rank">班排</th>
                            <th data-sort-key="rankDiff">班排变化</th>
                            <th data-sort-key="gradeRank">年排</th>
                            <th data-sort-key="gradeRankDiff">年排变化</th>
                        </tr>
                    </thead>
                    <tbody id="trend-table-body">
                        </tbody>
                </table>
            </div>
        </div>
    `;

    // 6. (新增) 绑定事件监听器 (不变)
    const searchInput = document.getElementById('trend-search');
    const tableHeader = document.getElementById('trend-table-header');
    const classFilterSelect = document.getElementById('trend-class-filter');
    const sortFilterSelect = document.getElementById('trend-sort-filter'); // [!!] (新增)

    searchInput.addEventListener('input', drawTable);
    classFilterSelect.addEventListener('change', drawCharts);
    sortFilterSelect.addEventListener('change', drawCharts);

    tableHeader.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;

        const newKey = th.dataset.sortKey;
        const { key, direction } = G_TrendSort;

        if (newKey === key) {
            G_TrendSort.direction = (direction === 'asc') ? 'desc' : 'asc';
        } else {
            G_TrendSort.key = newKey;
            G_TrendSort.direction = ['rankDiff', 'scoreDiff', 'gradeRankDiff'].includes(newKey) ? 'desc' : 'asc';
        }
        drawTable();
    });

    // 7. 初始绘制 (不变)
    G_TrendSort = { key: 'rank', direction: 'asc' };
    drawTable();
    drawCharts();
}


/**
 * 9.5. 模块五：学生分层筛选
 * [!!] (关键) A/B/C/D 快捷按钮现在从 config.good 读取
 */
function renderGroups(container, students) {
    // 1. (重构) 渲染筛选器卡片
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
                <label for="group-max"> < 分数 < </label>
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
                <div class="main-card-wrapper" style="padding: 10px;"> <div class="chart-container" id="group-class-pie-chart" style="height: 350px;"></div>
                </div>
                <div class="main-card-wrapper" style="padding: 10px;"> <div class="chart-container" id="group-radar-chart" style="height: 350px;"></div>
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

    // 3. (新增) 快捷按钮事件
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

            // [!!] 核心修正：从配置中读取可定义的 "良好线"
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

    // 4. (修改) 筛选按钮事件 (核心)
    filterBtn.addEventListener('click', () => {
        const subject = subjectSelect.value;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);

        const filteredStudents = students.filter(s => {
            const score = (subject === 'totalScore') ? s.totalScore : s.scores[subject];
            return score >= min && score <= max;
        });

        resultsWrapper.style.display = 'block';

        // 4.1 渲染表格
        if (filteredStudents.length === 0) {
            tableEl.innerHTML = `<p>在 ${min} - ${max} 分数段内没有找到学生。</p>`;
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

        // 4.2 (新增) 渲染图表
        renderGroupClassPie('group-class-pie-chart', filteredStudents);
        renderGroupRadarChart('group-radar-chart', filteredStudents, G_Statistics);
    });
}
/**
 * (新增) 9.6. 模块六：学科关联矩阵
 */
function renderCorrelation(container, activeData) {
    // 1. 渲染基础 HTML
    container.innerHTML = `
        <h2>模块九：学科关联矩阵 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">全科相关系数热力图</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(1: 强正相关, -1: 强负相关)</span>
            </div>
            <div class="chart-container" id="correlation-heatmap-chart" style="width: 100%; height: 600px;"></div>
        </div>
    `;

    // 2. 调用绘图函数
    renderCorrelationHeatmap('correlation-heatmap-chart', activeData);
}

/**
 * (新增) 9.7. 模块七：学生偏科诊断
 */
function renderWeakness(container, activeData, stats) { // [!!] (新增) 接收 G_Statistics
    // 1. 渲染基础 HTML
    container.innerHTML = `
        <h2>模块十：学生偏科诊断 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">偏科程度四象限图(右上 (高分-高偏科)：“尖子生但有短板” (重点关注)；右下 (高分-低偏科)：“学霸/全能型”；左上 (低分-高偏科)：“基础差且有极大短板”；左下 (低分-低偏科)：“基础薄弱但各科‘均衡’的差”)</h4>
            </div>
            <div class="chart-container" id="weakness-scatter-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
                    <div class="controls-bar chart-controls">
                        <h4 style="margin:0;">学生偏科诊断总表</h4>
                        <span style="font-size: 0.8em; color: var(--text-muted);">(按“最弱项偏离度”排序)</span>
                    </div>

                    <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0 0 15px 0;">
                        <label for="weakness-search">搜索学生:</label>
                        <input type="text" id="weakness-search" placeholder="输入姓名或考号...">
                    </div>

        <div class="table-container" id="weakness-table-container">
                        </div>

                    <div id="weakness-detail-container" style="margin-top: 20px; display: none;">
                        </div>
                </div>

            </div>
        `;

    // 2. (核心) 计算偏科数据
    const weaknessData = calculateWeaknessData(activeData, stats); // [!!] (修改) 传入 stats

    // 3. 渲染图表
    renderWeaknessScatter('weakness-scatter-chart', weaknessData, stats); // [!!] (修改) 传入 stats
    renderWeaknessTable('weakness-table-container', weaknessData);

    // 4. [!!] (新增) 绑定主表点击事件，用于显示详情表
    const tableContainer = document.getElementById('weakness-table-container');
    const detailContainer = document.getElementById('weakness-detail-container');

    tableContainer.addEventListener('click', (e) => {
        // (寻找被点击的行 <tr>, 必须有 data-id 属性)
        const row = e.target.closest('tr[data-id]');
        if (!row) return;

        const studentId = row.dataset.id;
        // (从原始数据中找到该学生)
        const studentData = weaknessData.find(d => String(d.student.id) === String(studentId));

        if (studentData) {
            renderWeaknessDetail(detailContainer, studentData); // 调用新函数
            detailContainer.style.display = 'block';
        }
    });
}

/**
 * (新增) 9.8. 模块八：临界生分析
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
    // (辅助函数) 渲染表格
    const renderResultTable = (title, students, targetSubject) => {
        resultsTitle.innerText = title;
        resultsWrapper.style.display = 'block';

        if (!students || students.length === 0) {
            resultsTable.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 20px;">未找到符合条件的学生。</p>`;
            return;
        }

        // [!!] (修改) 仅当 targetSubject 不是 'totalScore' 时才添加额外列
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
        // [!!] (重构)
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

        renderResultTable(`“${subject}” 在 “${lineTypeSelect.options[lineTypeSelect.selectedIndex].text}” ( ${threshold.toFixed(0)}分 ) ± ${range}分 的学生 (${filteredStudents.length}人)`, filteredStudents, subject);
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
                    return failCount === 1; // [!!] 严格限制为只有1科不及格
                });
            } else if (preset === 'holistic_excel') {
                title = '全科优秀生';
                filteredStudents = activeData.filter(s => {
                    return G_DynamicSubjectList.every(subject => {
                        const excelLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].excel : 0;
                        return (s.scores[subject] || 0) >= excelLine;
                    });
                });

                // [!!] (新增)
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
            renderResultTable(`${title} (${filteredStudents.length}人)`, filteredStudents, null);
        });
    });
    // [!!] (新增) 为结果表添加点击事件
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
            // (调用新函数渲染详情)
            renderBoundaryStudentDetail(detailContainer, student);
            detailContainer.style.display = 'block';
        }
    });
}



/**
 * (新增) 9.9. 模块九：全科均衡分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 * @param {Object} stats - G_Statistics
 */
function renderHolisticBalance(container, activeData, stats) {

    // 1. 渲染HTML
    container.innerHTML = `
        <h2>模块六：全科均衡分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            分析学生群体的“短板”数量分布。点击下方柱状图可查看学生列表。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4 style="margin:0;">不及格科目数量分布</h4>
            <div class="chart-container" id="holistic-failure-count-chart" style="height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" id="holistic-results-wrapper" style="display: none;">
            <h4 id="holistic-results-title">学生列表</h4>
            <div class="table-container" id="holistic-results-table"></div>
        </div>
    `;

    // 2. (核心) [!!] (修改) 计算不及格科目数, 并存储学生对象
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
        failureData[count].push(student); // [!!] (修改) 存入学生对象
    });

    // 3. [!!] (修改) 渲染图表, 并获取 ECharts 实例
    const chartInstance = renderFailureCountChart('holistic-failure-count-chart', failureData);

    // 4. [!!] (新增) 绑定图表点击事件
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
}

/**
 * (新增) 9.10. 模块十：成绩分布变动
 * @param {Object} container - HTML 容器
 * @param {Array} currentData - (已筛选) 本次学生数据
 * @param {Array} compareData - (已筛选) 对比学生数据
 * @param {Object} currentStats - G_Statistics
 * @param {Object} compareStats - G_CompareStatistics
 */
/**
 * (新增) 模块七：成绩分布变动 (支持桑基图按科目查看 - 修复版)
 */
function renderTrendDistribution(container, currentData, compareData, currentStats, compareStats, currentFilter) {

    // 1. 检查是否有对比数据
    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块七：成绩分布变动</h2><p>请先在侧边栏导入 "对比成绩" 数据。</p>`;
        return;
    }

    // [!! 核心修复 !!] 检查对比数据是否缺少单科排名
    // 如果 compareData 的第一个学生没有 gradeRanks 属性，说明数据是旧的，需要重新计算
    if (compareData.length > 0 && !compareData[0].gradeRanks) {
        console.warn("检测到对比数据缺少单科排名，正在自动补全...");
        // 借用 addSubjectRanksToData 函数重新计算排名
        // 注意：这里我们假设 addSubjectRanksToData 已经定义在全局作用域
        compareData = addSubjectRanksToData(compareData);
        // 存回缓存，避免下次还要算
        localStorage.setItem('G_CompareData', JSON.stringify(compareData));
    }

    // 2. 渲染HTML
    container.innerHTML = `
        <h2>模块七：成绩分布变动 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            对比两次考试的“群体形态”变化。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="dist-subject-select">选择科目 (直方图):</label>
                <select id="dist-subject-select" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
            </div>
            <div class="chart-container" id="dist-overlap-histogram-chart" style="height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls" style="border-bottom: none; padding-bottom: 0; margin-bottom: 10px;">
                <h4 style="margin: 0; margin-right: 20px;">排名分层流动图 (桑基图)</h4>
                <label for="dist-sankey-subject-select">分析对象:</label>
                <select id="dist-sankey-subject-select" class="sidebar-select" style="width: auto;">
                    <option value="totalScore">总分排名</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}排名</option>`).join('')}
                </select>
            </div>
            <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                点击图中的“节点”或“流向”可查看学生列表。(绿色表示向上流动，红色表示向下流动)
            </p>
            <div class="chart-container" id="dist-sankey-chart" style="height: 600px;"></div>
        </div>

        <div class="main-card-wrapper" id="dist-sankey-results-wrapper" style="display: none; margin-top: 20px;">
            <h4 id="dist-sankey-results-title">学生列表</h4>
            <div class="table-container" id="dist-sankey-results-table"></div>
        </div>
    `;

    // 3. 匹配两个数据源 (包含 oldGradeRank 和 oldClassRanks)
    const mergedData = currentData.map(student => {
        const oldStudent = compareData.find(s => String(s.id) === String(student.id));
        if (!oldStudent) return null;

        return {
            ...student,
            oldTotalScore: oldStudent.totalScore,
            oldRank: oldStudent.rank,
            oldGradeRank: oldStudent.gradeRank || 0,
            // [!!] 确保这里能取到数据，即使是空对象
            oldScores: oldStudent.scores || {},
            oldClassRanks: oldStudent.classRanks || {},
            oldGradeRanks: oldStudent.gradeRanks || {}
        };
    }).filter(s => s !== null);


    // 4. 绑定直方图事件
    const subjectSelect = document.getElementById('dist-subject-select');
    const drawHistogram = () => {
        const subject = subjectSelect.value;
        const currentScores = (subject === 'totalScore')
            ? currentData.map(s => s.totalScore)
            : currentData.map(s => s.scores[subject]);

        const compareScores = (subject === 'totalScore')
            ? compareData.map(s => s.totalScore)
            : compareData.map(s => s.scores[subject]);

        renderOverlappingHistogram('dist-overlap-histogram-chart', currentScores, compareScores, subject);
    };
    subjectSelect.addEventListener('change', drawHistogram);

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
    drawSankey();

    // 7. 绑定桑基图点击事件 (逻辑保持最新)
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

                // 动态获取排名和分数
                const getRanks = (s) => {
                    if (isTotal) {
                        return {
                            old: useGradeRank ? s.oldGradeRank : s.oldRank,
                            new: useGradeRank ? s.gradeRank : s.rank,
                            oldScore: s.oldTotalScore,
                            newScore: s.totalScore
                        };
                    } else {
                        return {
                            old: useGradeRank ? (s.oldGradeRanks[subject] || 0) : (s.oldClassRanks[subject] || 0),
                            new: useGradeRank ? (s.gradeRanks[subject] || 0) : (s.classRanks[subject] || 0),
                            oldScore: s.oldScores[subject],
                            newScore: s.scores[subject]
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
                    const nodeName = data.name.replace('上次: ', '').replace('本次: ', '');
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
                                        <th>本次${scoreLabel}</th><th>本次${rankLabel}</th>
                                        <th>上次${scoreLabel}</th><th>上次${rankLabel}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${students.map(s => {
                        const r = getRanks(s);
                        const tierOld = rankTiers.findIndex(t => t.name === getRankCategory(r.old));
                        const tierNew = rankTiers.findIndex(t => t.name === getRankCategory(r.new));
                        let rowClass = '';
                        if (tierOld > tierNew) rowClass = 'progress';
                        else if (tierOld < tierNew) rowClass = 'regress';

                        return `
                                        <tr class="${rowClass}">
                                            <td>${s.name}</td><td>${s.class}</td>
                                            <td><strong>${r.newScore ?? '-'}</strong></td>
                                            <td>${r.new}</td>
                                            <td>${r.oldScore ?? '-'}</td>
                                            <td>${r.old}</td>
                                        </tr>`;
                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }
            });
        }
    }
}

/**
 * (重构) 9.11. 模块十二：多次考试分析
 * [!! 完整修复版 !!]
 * - 包含了图表3的 HTML 结构。
 * - 包含了下拉框 (multi-rank-type-select) 的事件监听器。
 */
function renderMultiExam(container) {

    // 1. 渲染模块 HTML
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
                        📊 添加新成绩 (可多选)
                    </label>
                    <input type="file" id="multi-file-uploader" accept=".xlsx, .xls, .csv" style="display: none;" multiple>

                    <label for="multi-json-uploader" class="upload-label" style="padding: 10px 16px; background-color: var(--color-orange); color: white;">
                        📥 导入备份 (JSON)
                    </label>
                    <input type="file" id="multi-json-uploader" accept=".json" style="display: none;">
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button id="multi-export-all" class="sidebar-button" style="background-color: var(--color-green);">
                        📤 导出备份 (JSON)
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
    listContainer.addEventListener('input', (e) => {
        if (e.target && e.target.dataset.role === 'label') {
            const id = e.target.closest('li').dataset.id;
            const newLabel = e.target.value;
            let data = loadMultiExamData();
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
    listContainer.addEventListener('click', (e) => {
        if (!e.target) return;
        const button = e.target.closest('button');
        if (!button) return;

        const role = button.dataset.role;
        const id = button.closest('li').dataset.id;
        let data = loadMultiExamData();
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

    // (导出备份)
    exportBtn.addEventListener('click', () => {
        const data = loadMultiExamData();
        if (data.length === 0) {
            alert('没有可导出的数据。');
            return;
        }
        try {
            const jsonString = JSON.stringify(data);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `成绩分析系统_多次考试备份_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            statusLabel.innerText = `✅ 成功导出 ${data.length} 条考试数据。`;
        } catch (err) {
            statusLabel.innerText = `❌ 导出失败: ${err.message}`;
            console.error(err);
        }
    });

    // (导入备份)
    jsonUploader.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusLabel.innerText = `🔄 正在读取备份文件...`;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!Array.isArray(importedData) || (importedData.length > 0 && !importedData[0].students)) {
                    throw new Error('文件格式不正确，不是有效的备份文件。');
                }
                if (confirm(`您确定要用此文件中的 ${importedData.length} 条数据，覆盖当前所有“多次考试”数据吗？`)) {
                    saveMultiExamData(importedData);
                    renderMultiExamList(importedData);
                    initializeStudentSearch(importedData);
                    document.getElementById('multi-student-report').style.display = 'none';
                    statusLabel.innerText = `✅ 成功导入 ${importedData.length} 条考试数据。`;
                } else {
                    statusLabel.innerText = '导入操作已取消。';
                }
            } catch (err) {
                statusLabel.innerText = `❌ 导入失败: ${err.message}`;
                console.error(err);
            } finally {
                jsonUploader.value = null;
            }
        };
        reader.onerror = () => {
            statusLabel.innerText = '❌ 文件读取失败。';
            jsonUploader.value = null;
        };
        reader.readAsText(file);
    });

    // 3. 初始化数据
    loadMultiExamData().then(initialData => {
        renderMultiExamList(initialData);
        initializeStudentSearch(initialData);
    });

    // ------------------------------------------------------------------
    // [!! 核心修复 !!] 在这里绑定“排名类型”和“复选框”的监听器
    // ------------------------------------------------------------------

    // (监听: 排名类型下拉框)
    const rankTypeSelect = document.getElementById('multi-rank-type-select');
    if (rankTypeSelect) {
        rankTypeSelect.addEventListener('change', () => {
            const reportContainer = document.getElementById('multi-student-report');
            const currentStudentId = reportContainer.dataset.studentId;
            if (currentStudentId) {
                drawMultiExamChartsAndTable(currentStudentId, loadMultiExamData(), false);
            }
        });
    }

    // (监听: 复选框容器)
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    if (checkboxContainer) {
        checkboxContainer.addEventListener('change', () => {
            const reportContainer = document.getElementById('multi-student-report');
            const currentStudentId = reportContainer.dataset.studentId;
            if (currentStudentId) {
                drawMultiExamChartsAndTable(currentStudentId, loadMultiExamData(), false);
            }
        });
    }

    // (监听: 全选)
    const selectAllBtn = document.getElementById('multi-subject-all');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            if (checkboxContainer) {
                checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                const reportContainer = document.getElementById('multi-student-report');
                const currentStudentId = reportContainer.dataset.studentId;
                if (currentStudentId) drawMultiExamChartsAndTable(currentStudentId, loadMultiExamData(), false);
            }
        });
    }

    // (监听: 全不选)
    const selectNoneBtn = document.getElementById('multi-subject-none');
    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', () => {
            if (checkboxContainer) {
                checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                const reportContainer = document.getElementById('multi-student-report');
                const currentStudentId = reportContainer.dataset.studentId;
                if (currentStudentId) drawMultiExamChartsAndTable(currentStudentId, loadMultiExamData(), false);
            }
        });
    }
}


/**
 * (新增) 10.15. 渲染学科关联热力图 (Heatmap)
 * [!!] (已修复)
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

    // [!!] (逻辑修复)
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
                // [!!] (核心修复)
                // (我们不重新计算, 而是从已存的对称矩阵中检索值)
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
 * 10.1. 渲染直方图 (Histogram)
 * [!!] 修复了 "effectiveBinSize is not defined" 的引用错误
 * [!!] 高亮最大值和最小值的柱子
 * [!!] Tooltip 中显示学生姓名
 */
function renderHistogram(elementId, students, scoreKey, fullScore, title, binSize) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    const myChart = echarts.init(chartDom); // 改用 myChart 变量方便绑定事件
    echartsInstances[elementId] = myChart;

    // 检查是否有有效分数
    if (!students || students.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无数据可供显示。</p>`;
        return;
    }

    // 1. (新增) 从学生数据中提取分数
    const scores = students.map(s => {
        const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
        return (typeof score === 'number' && !isNaN(score)) ? score : null;
    }).filter(s => s !== null).sort((a, b) => a - b);

    if (scores.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无有效分数数据。</p>`;
        return;
    }

    // [!!] 核心修正：effectiveBinSize 必须在这里定义
    const effectiveBinSize = binSize > 0 ? binSize : Math.max(10, Math.ceil(fullScore / 10));

    // 2. X轴截断逻辑 (现在可以正常工作了)
    const minScore = scores[0];
    const maxScore = scores[scores.length - 1];
    const startBin = Math.floor(minScore / effectiveBinSize) * effectiveBinSize;
    const endBinLimit = Math.min(Math.ceil((maxScore + 0.01) / effectiveBinSize) * effectiveBinSize, fullScore);

    // 3. (修改) 动态生成分数段 (bins)
    const bins = {};
    let labels = [];

    for (let i = startBin; i < endBinLimit; i += effectiveBinSize) {
        const end = Math.min(i + effectiveBinSize, fullScore);
        const label = `${i}-${end}`;
        bins[label] = [];
        labels.push(label);
    }

    // 4. (修改) 填充数据
    students.forEach(student => {
        const score = (scoreKey === 'totalScore') ? student.totalScore : student.scores[scoreKey];
        if (typeof score !== 'number' || isNaN(score) || score < startBin) return;

        if (score === fullScore) {
            const lastLabel = labels[labels.length - 1];
            if (bins[lastLabel] !== undefined) bins[lastLabel].push(student.name);
        } else {
            const binIndex = Math.floor((score - startBin) / effectiveBinSize);
            if (labels[binIndex] && bins.hasOwnProperty(labels[binIndex])) {
                bins[labels[binIndex]].push(student.name);
            }
        }
    });

    // 5. (修改) 准备 ECharts Series 数据
    // (先找出最大/最小值，用于高亮)
    let maxValue = -Infinity;
    let minValue = Infinity;
    const counts = labels.map(label => (bins[label] || []).length);

    const validCounts = counts.filter(v => v > 0);
    if (validCounts.length > 0) {
        minValue = Math.min(...validCounts);
    } else {
        minValue = 0;
    }
    maxValue = Math.max(...counts);

    // (构建 Series Data)
    const seriesData = labels.map(label => {
        const studentNames = bins[label] || [];
        const count = studentNames.length;

        let color;
        if (count === maxValue && maxValue !== 0) {
            color = '#28a745'; // Green
        } else if (count === minValue && minValue !== maxValue) {
            color = '#dc3545'; // Red
        } else {
            color = '#007bff'; // Blue (Default)
        }

        return {
            value: count,
            names: studentNames,
            itemStyle: { color: color } // [!!] (新增)
        };
    });

    const option = {
        title: { text: title, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const param = params[0];
                const data = param.data;
                const binLabel = param.name;
                const count = data.value;
                const names = data.names;

                if (count === 0) {
                    return `<strong>${binLabel}</strong><br/>人数: 0`;
                }

                let namesHtml = names.slice(0, 10).join('<br/>');
                if (names.length > 10) {
                    namesHtml += `<br/>... (及另外 ${names.length - 10} 人)`;
                }

                return `<strong>${binLabel}</strong><br/>` +
                    `<strong>人数: ${count}</strong><hr style="margin: 5px 0; border-color: #eee;"/>` +
                    `${namesHtml}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: '分数段',
            axisLabel: {
                interval: 'auto',
                rotate: labels.length > 10 ? 30 : 0
            }
        },
        yAxis: { type: 'value', name: '学生人数' },
        series: [{
            name: '人数',
            type: 'bar',
            data: seriesData
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);

    myChart.setOption(option);

    // [新增] 6. 绑定点击事件 (Drill-down)
    myChart.on('click', function (params) {
        // params.name 是 X 轴的标签，例如 "60-70" 或 "150"
        const label = params.name;

        let drilledStudents = [];

        if (label.includes('-')) {
            // 范围解析 (例如 "60-70")
            const parts = label.split('-');
            const min = parseFloat(parts[0]);
            const max = parseFloat(parts[1]); // 注意：这里的 max 在显示逻辑里通常是开区间或闭区间，要看你的分箱逻辑

            drilledStudents = students.filter(s => {
                const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
                // 这里的逻辑要和你的分箱逻辑完全一致
                // 通常是: score >= min && score < max
                // 除非是最后一个区间或者最高分
                if (typeof score !== 'number') return false;

                // 特殊处理满分 (如果你的分箱逻辑把满分单独放或者放在最后一段)
                // 简单的范围判断:
                return score >= min && score < max;
            });

            // 补丁：如果你的分箱逻辑是 [min, max)，那么最高分可能漏掉。
            // 如果点击的是最后一个柱子，应该包含等于 endBinLimit 的值
            // 或者我们可以简化：利用你之前 bins 逻辑里存的 name 来匹配 (更准确)

            // [更精准的方案]：利用之前计算好的 bins (如果你存了 ID)
            // 但为了不重构所有代码，我们这里用简单的“再筛选”：
            // 你的 fillBins 逻辑里：
            // if (score === fullScore) -> lastLabel
            // else -> [min, min+binSize)

            // 修正筛选逻辑：
            drilledStudents = students.filter(s => {
                const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
                if (typeof score !== 'number') return false;

                // 满分单独处理 (假设 label 是 "140-150" 且满分是 150)
                if (score === fullScore && label.endsWith('-' + fullScore)) {
                    return true;
                }
                return score >= min && score < max;
            });

        } else {
            // 单值 (例如标签就是 "150" 或者某种分类)
            // 如果你的直方图有纯数字标签
            const val = parseFloat(label);
            drilledStudents = students.filter(s => {
                const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
                return Math.abs(score - val) < 0.01; // 浮点数相等判断
            });
        }

        // 调用通用模态框
        const subjectName = (scoreKey === 'totalScore') ? '总分' : scoreKey;
        showDrillDownModal(`"${subjectName}" 分数段 [${label}] 学生名单`, drilledStudents, scoreKey);
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
        return { name: subject, max: full }; // (新增) max 动态读取配置
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
 * [!!] 已修改：高亮显示最大值和最小值
 * [!!] 已修改：标签格式化为 2 位小数
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

    // [!!] (新增) 找出最大值和最小值
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

    // [!!] (新增) 准备 Series 数据，用于高亮
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
            data: seriesData, // [!!] 使用新的 seriesData
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
 * (新增) 10.4. 渲染班级对比条形图
 * [!!] 已修改：高亮显示最大值(绿色)和最小值(红色)
 */
function renderClassComparisonChart(elementId, data, title) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // [!!] (修改) 找出最大值和最小值
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

    // [!!] (修改) 将 'values' 数组转换为包含自定义样式的 'seriesData' 数组
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
            data: seriesData, // [!!] (修改) 使用新的 seriesData
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
 * (已修改) 10.5. 渲染多科目箱形图
 * [!!] (重构) 手动计算箱形图数据，以便在异常值中显示学生姓名
 * @param {string} elementId
 * @param {Object} stats - G_Statistics
 * @param {Array} activeData - 传入学生数据
 */
function renderSubjectBoxPlot(elementId, stats, activeData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. [!!] (新增) 辅助函数：手动计算分位数
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

    // 2. [!!] (重构) 遍历所有科目
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
                        name: `${student.name} (${student.class})`, // [!!] (新增) 存储学生信息
                        value: [subjectIndex, score] // [X轴索引, Y轴分数]
                    });
                }
            }
        });
    });

    // 3. [!!] (删除) 移除 dataTool
    // const allScores = ...
    // const boxplotData = echarts.dataTool.prepareBoxplotData(allScores);

    // 4. (重构) ECharts 配置
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
            data: labels, // [!!] (修改)
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
                data: boxData, // [!!] (修改)
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
                data: scatterData, // [!!] (修改)
                // [!!] (新增) 为异常值定制 Tooltip
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
 * (已修改) 10.6. 渲染学科关联性散点图
 * [!!] (重构) 现在调用 calculateCorrelation() 辅助函数
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

    // 2. [!!] (重构) 调用新的辅助函数
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
 * (已修改) 10.7. 渲染 A/B/C/D 堆叠百分比条形图
 * [!!] (关键) A/B/C/D 的分界线现在从 config.good 读取
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
        // [!!] 核心修正：从配置中读取可定义的 "良好线"
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
 * (已修改) 10.8. 渲染学生个体 vs 年级平均雷达图
 * [!!] 新增了颜色区分
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
                // [!!] 修正：tooltip 中也显示对应的颜色标记
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
            // [!!] 添加颜色配置
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
                    // [!!] 添加区域颜色
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
                    // [!!] 添加区域颜色
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
 * (新增) 10.9. 渲染 难度-区分度 散点图
 * (用于试卷科目分析模块)
 * @param {string} elementId - DOM 元素 ID
 * @param {Object} stats - G_Statistics
 */
/**
 * (新增) 10.9. 渲染 难度-区分度 散点图 (修复版：带十字象限线)
 * [!!] 新增 markLine 功能，自动画出平均线，形成四个象限
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
            // [!!] 给气泡加个颜色，语数英深一点
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
            // [!! 核心修改 !!] 添加十字辅助线 (MarkLine)
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
            // [!! 可选 !!] 添加四个象限的背景色 (让分区更明显)
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
 * (新增) 10.10. 渲染进退步散点图 (Barbell Plot)
 * (用于成绩趋势对比模块)
 */
function renderTrendScatter(elementId, students) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤掉没有对比数据的学生，并按新排名排序
    const data = students
        .filter(s => s.oldRank !== null)
        .sort((a, b) => a.rank - b.rank); // 按新排名升序

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
            inverse: true // [!!] 排名 1 在右侧
        },
        yAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: { show: false }, // [!!] 姓名太多, 默认隐藏 (见 CSS)
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
 * (新增) 10.11. 渲染班排变化直方图
 * (用于成绩趋势对比模块)
 */
function renderTrendRankHistogram(elementId, allRankDiffs) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤无效数据
    const validDiffs = allRankDiffs.filter(d => typeof d === 'number');
    if (validDiffs.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无对比数据。</p>`;
        return;
    }

    // 2. 动态计算分箱 (binSize=5)
    const min = Math.min(...validDiffs);
    const max = Math.max(...validDiffs);
    const binSize = 5;

    const startBin = Math.floor(min / binSize) * binSize;
    const endBinLimit = Math.ceil((max + 1) / binSize) * binSize; // +1 确保最大值被包含

    const bins = {};
    const labels = [];
    for (let i = startBin; i < endBinLimit; i += binSize) {
        const label = `${i} ~ ${i + binSize - 1}`;
        bins[label] = 0;
        labels.push(label);
    }

    // 3. 填充数据
    validDiffs.forEach(diff => {
        const binIndex = Math.floor((diff - startBin) / binSize);
        if (labels[binIndex] && bins[labels[binIndex]] !== undefined) {
            bins[labels[binIndex]]++;
        }
    });

    const option = {
        title: {
            text: '班排变化分布',
            subtext: 'X轴: 排名变化 (正数为进步)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const p = params[0];
                return `<strong>${p.name} 名</strong><br/>人数: ${p.value}`;
            }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: Object.values(bins),
            // [!!] 颜色区分
            itemStyle: {
                color: (params) => {
                    // (简单判断) "0 ~ 4" 包含 0
                    if (params.name.startsWith('0 ~') || params.name.includes('-')) {
                        const start = parseInt(params.name.split(' ~ ')[0]);
                        if (start > 0) return '#28a745'; // 进步
                        if (start < -binSize + 1) return '#dc3545'; // 退步
                    }
                    return '#aaa'; // 中间
                }
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
 * (已修改) 10.11. 渲染学生进退步条形图
 * [!!] X轴 已修改为按 "学生姓名" 排序
 * [!!] 强制显示所有 X 轴标签 (interval: 0)
 */
// [!!] (修改) 增加 sortBy 参数, 默认为 'name'
function renderRankChangeBarChart(elementId, students, sortBy = 'name') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤掉没有对比数据的学生
    const data = students.filter(s => s.oldRank !== null || s.oldGradeRank !== null);

    // [!!] (修改) 2. 根据 sortBy 参数动态排序
    const sortOption = sortBy.split('_');
    const sortKey = sortOption[0];
    const sortDir = sortOption[1] || 'asc'; // 'asc' for name, 'desc' for ranks by default

    data.sort((a, b) => {
        if (sortKey === 'name') {
            return a.name.localeCompare(b.name);
        }

        // (处理 null/undefined)
        let valA = a[sortKey];
        let valB = b[sortKey];

        // 将 null 视为最末尾
        valA = (valA === null || valA === undefined) ? (sortDir === 'asc' ? Infinity : -Infinity) : valA;
        valB = (valB === null || valB === undefined) ? (sortDir === 'asc' ? Infinity : -Infinity) : valB;

        return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    // 3. 准备 ECharts 数据
    const studentNames = data.map(s => s.name);
    const classRankDiffs = data.map(s => s.rankDiff);
    const gradeRankDiffs = data.map(s => s.gradeRankDiff);

    const option = {
        title: {
            text: '学生 班排/年排 变化',
            subtext: '按学生姓名排序',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const studentName = params[0].name;
                let tip = `<strong>${studentName}</strong><br/>`;
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
        grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, top: 100 }, // [!!] 调整 bottom
        xAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: {
                rotate: 30, // 旋转标签
                interval: 0 // [!!] 核心修正：强制显示所有标签
            }
        },
        yAxis: {
            type: 'value',
            name: '排名变化 (正数为进步)'
        },
        dataZoom: [
            {
                type: 'inside',
                xAxisIndex: [0]
            },
            {
                type: 'slider',
                xAxisIndex: [0],
                bottom: 10, // [!!] 调整 dataZoom 位置
                height: 20
            }
        ],
        series: [
            {
                name: '班排变化',
                type: 'bar',
                barWidth: '50%',
                emphasis: { focus: 'series' },
                data: classRankDiffs,
                itemStyle: {
                    color: '#007bff' // 蓝色
                }
            },
            {
                name: '年排变化',
                type: 'bar',
                barWidth: '50%',
                emphasis: { focus: 'series' },
                data: gradeRankDiffs,
                itemStyle: {
                    color: '#ffc107' // 黄色
                }
            }
        ]
    };
    // [!!] 调整 grid 和 dataZoom 的位置
    option.grid.bottom = (data.length > 20 ? 50 : 30) + 'px'; // 如果人多，为 slider 留空间
    option.dataZoom[1].bottom = 10;

    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.16. [辅助函数] 计算偏科分析数据
 * (这是新模块的核心)
 */
// [!!] (修改) 接收 G_Statistics
function calculateWeaknessData(students, stats) {

    // (辅助函数)
    const mean = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const validArr = arr.filter(v => typeof v === 'number' && !isNaN(v)); // [!!] (健壮性)
        if (validArr.length === 0) return 0;
        return validArr.reduce((sum, val) => sum + val, 0) / validArr.length;
    };
    const stdDev = (arr, meanVal) => {
        if (!arr || arr.length < 2) return 0;
        const validArr = arr.filter(v => typeof v === 'number' && !isNaN(v)); // [!!] (健壮性)
        if (validArr.length < 2) return 0;
        return Math.sqrt(validArr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / validArr.length);
    };

    const results = [];

    students.forEach(student => {
        // 1. [!!] (修改) 计算该生的所有 "Z-Score" (标准分)
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

        // 2. [!!] (修改) 计算该生的 "平均Z-Score" 和 "Z-Score标准差" (即偏科程度)
        const avgZScore = mean(zScores);
        const stdDevZScore = stdDev(zScores, avgZScore);

        // 3. [!!] (修改) 计算每科的 "Z-Score偏离度"
        const subjectDeviations = [];
        zScores.forEach((z, index) => {
            const subject = validSubjects[index];
            subjectDeviations.push({
                subject: subject,
                zScore: parseFloat(z.toFixed(2)), // [!!] 该科Z分
                deviation: parseFloat((z - avgZScore).toFixed(2)) // [!!] 偏离度
            });
        });

        results.push({
            student: student,
            avgZScore: parseFloat(avgZScore.toFixed(2)), // [!!] (新) 学生综合能力 (Z分均值)
            stdDevZScore: parseFloat(stdDevZScore.toFixed(2)), // [!!] (新) 学生偏科程度 (Z分标准差)
            subjectDeviations: subjectDeviations
        });
    });

    return results.filter(r => r !== null); // 过滤掉无法分析的学生
}


/**
 * (最终修复版 V4 - 完美版) 解决 MarkLine、四色渲染、queryComponents 错误，并实现 X 轴动态缩放。
 */
// [!!] (修改) 接收 G_Statistics
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

    // 1. [!!] (修改) 计算平均线
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
        // [!!] (修改) 使用 Z-Score
        const x = data.avgZScore;
        const y = data.stdDevZScore;
        const studentName = data.student.name;

        if (typeof x !== 'number' || isNaN(x) || typeof y !== 'number' || isNaN(y)) return;

        xValuesRaw.push(x);
        yValuesRaw.push(y);

        const quadrantKey = (x >= avgZScoreLine ? '右' : '左') + (y >= avgStdDev ? '上' : '下');
        quadrantData[quadrantKey].push([x, y, studentName]);
    });

    // 3. 🚀 [!!] (修改) 动态计算坐标轴范围 (Z-Score)
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
                // [!!] (修改) 更新 Tooltip
                return `<strong>${data[2]}</strong><br/>` +
                    `综合能力 (Z-Score均值): ${data[0].toFixed(2)}<br/>` +
                    `偏科程度 (Z-Score标准差): ${data[1].toFixed(2)}`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '10%', top: '10%' },
        xAxis: {
            type: 'value',
            // [!!] (修改) 更新 X 轴
            name: '综合能力 (平均Z-Score)',
            nameLocation: 'middle',
            nameGap: 30,
            min: dynamicMinX,
            max: dynamicMaxX
        },
        // [!!] (修改) 更新 Y 轴
        yAxis: { type: 'value', name: '偏科程度 (Z-Score标准差)', nameLocation: 'middle', nameGap: 40, min: 0, max: dynamicMaxY },

        series: [
            // 四个散点图系列 (保持不变)
            { name: '右上象限', type: 'scatter', data: quadrantData['右上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右上'] } },
            { name: '左上象限', type: 'scatter', data: quadrantData['左上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左上'] } },
            { name: '右下象限', type: 'scatter', data: quadrantData['右下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右下'] } },
            { name: '左下象限', type: 'scatter', data: quadrantData['左下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左下'] } },

            // [!!] (修改) 更新辅助 MarkLine
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
        // [!!] (修改) 使用 Z-Score 均值线
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
 * (新增) 10.18. 渲染“短板”学生表格
 */
function renderWeaknessTable(elementId, weaknessData) {
    const tableContainer = document.getElementById(elementId);
    if (!tableContainer) return;

    // 1. [!!] (重构) 创建 "学生最弱项" 列表
    // (不再使用 flatList, 而是每个学生一行)
    const studentWeaknessList = weaknessData.map(data => {
        if (!data.subjectDeviations || data.subjectDeviations.length === 0) {
            return { // (处理没有有效数据的学生)
                name: data.student.name,
                id: data.student.id,
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
            avgZScore: data.avgZScore,
            weakestSubject: weakest.subject,
            weakestDeviation: weakest.deviation,
            weakestZScore: weakest.zScore
        };
    });

    // 2. 默认排序：按“最弱项偏离度”升序 (最弱的在最前面)
    studentWeaknessList.sort((a, b) => a.weakestDeviation - b.weakestDeviation);

    // 3. (新增) 渲染表格的内部函数 (用于搜索)
    const drawTable = () => {
        const searchTerm = document.getElementById('weakness-search').value.toLowerCase();

        const filteredList = studentWeaknessList.filter(item => {
            return String(item.name).toLowerCase().includes(searchTerm) ||
                String(item.id).toLowerCase().includes(searchTerm);
        });

        let html = ``;
        if (filteredList.length === 0) {
            html = `<p style="text-align: center; padding: 20px; color: var(--text-muted);">未找到匹配的学生。</p>`;
        } else {
            html = `
                <table>
                    <thead>
                        <tr>
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
                                <td><strong>${item.name}</strong></td>
                                <td>${item.id}</td>
                                <td><strong>${item.weakestSubject}</strong></td>
                                <td><strong class="${item.weakestDeviation < -0.5 ? 'regress' : ''}">${item.weakestDeviation.toFixed(2)}</strong></td>
                                <td>${item.weakestZScore.toFixed ? item.weakestZScore.toFixed(2) : 'N/A'}</td>
                                <td>${item.avgZScore.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
        tableContainer.innerHTML = html;
    };

    // 4. (新增) 绑定搜索框事件
    // (搜索框是在 renderWeakness 中创建的)
    const searchInput = document.getElementById('weakness-search');
    if (searchInput) {
        searchInput.addEventListener('input', drawTable);
    }

    // 5. 初始绘制
    drawTable();
}

/**
 * (新增) 10.19. 渲染单个学生的详细偏科表
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
                        <th>该科Z-Score</th>
                        <th>学生平均Z-Score</th>
                        <th>偏离度 (该科Z - 均Z)</th>
                    </tr>
                </thead>
                <tbody>
                    ${deviations.map(item => `
                        <tr>
                            <td><strong>${item.subject}</strong></td>
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
// (新增) 10.21. 渲染不及格科目数条形图
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
 * (新增) 10.22. 渲染重叠直方图 (升级版：带平均分辅助线和难度显示)
 */
function renderOverlappingHistogram(elementId, currentScores, compareScores, subjectName) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const cleanCurrent = currentScores.filter(s => typeof s === 'number' && !isNaN(s));
    const cleanCompare = compareScores.filter(s => typeof s === 'number' && !isNaN(s));

    if (cleanCurrent.length === 0 && cleanCompare.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无数据可供显示。</p>`;
        return;
    }

    // --- 1. 计算统计指标 (平均分 & 难度) ---
    const calcStats = (scores) => {
        if (scores.length === 0) return { avg: 0, diff: 0 };
        const sum = scores.reduce((a, b) => a + b, 0);
        const avg = sum / scores.length;
        // 获取该科满分 (用于计算难度)
        let fullScore = 100;
        if (subjectName === 'totalScore') {
            fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
        } else {
            fullScore = G_SubjectConfigs[subjectName]?.full || 100;
        }
        return {
            avg: parseFloat(avg.toFixed(1)),
            difficulty: parseFloat((avg / fullScore).toFixed(2)),
            full: fullScore
        };
    };

    const currStats = calcStats(cleanCurrent);
    const compStats = calcStats(cleanCompare);

    // --- 2. 确定统一的分箱 ---
    const allScores = [...cleanCurrent, ...cleanCompare];
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);

    // 动态计算 binSize
    const fullScore = currStats.full;
    const binSize = Math.max(5, Math.round(fullScore / 20)); // 稍微细一点的分箱

    // 优化 X 轴起点，使其看起来更整齐 (比如 55 变成 50)
    const startBin = Math.floor(min / binSize) * binSize;
    const endBinLimit = Math.ceil((max + 0.01) / binSize) * binSize;

    const labels = [];
    const binsCurrent = {};
    const binsCompare = {};

    for (let i = startBin; i < endBinLimit; i += binSize) {
        const label = `${i}-${i + binSize}`;
        labels.push(label);
        binsCurrent[label] = 0;
        binsCompare[label] = 0;
    }

    // 填充数据
    const fillBins = (scores, bins) => {
        scores.forEach(score => {
            if (score >= endBinLimit) { // 处理满分边界
                const lastLabel = labels[labels.length - 1];
                if (lastLabel) bins[lastLabel]++;
            } else {
                const binIndex = Math.floor((score - startBin) / binSize);
                const label = labels[binIndex];
                if (label) bins[label]++;
            }
        });
    };

    fillBins(cleanCurrent, binsCurrent);
    fillBins(cleanCompare, binsCompare);

    const dataCurrent = labels.map(label => binsCurrent[label]);
    const dataCompare = labels.map(label => binsCompare[label]);

    // --- 3. 构建图表配置 ---
    const option = {
        title: {
            text: `${subjectName} 成绩分布对比`,
            // [!!] 在副标题显示难度系数差异
            subtext: `本次均分: ${currStats.avg} (难度:${currStats.difficulty})  vs  上次均分: ${compStats.avg} (难度:${compStats.difficulty})`,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' },
            subtextStyle: { fontSize: 12, color: '#666' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        legend: {
            data: ['本次成绩', '对比成绩'],
            top: 50
        },
        grid: { left: '3%', right: '4%', bottom: '10%', top: 80, containLabel: true }, // 增加 top 给副标题留空
        xAxis: {
            type: 'category',
            data: labels,
            name: '分数段',
            axisLabel: { interval: 'auto', rotate: 30 }
        },
        yAxis: { type: 'value', name: '人数' },
        series: [
            {
                name: '对比成绩',
                type: 'bar',
                data: dataCompare,
                itemStyle: { color: '#ccc' }, // 灰色
                // [!!] 添加平均分辅助线
                markLine: {
                    symbol: 'none',
                    data: [
                        {
                            name: '上次平均分',
                            xAxis: (compStats.avg - startBin) / binSize, // 计算平均分在 X 轴的位置
                            lineStyle: { color: '#999', type: 'dashed', width: 2 },
                            label: { formatter: '上次均分\n{c}', position: 'start' },
                            value: compStats.avg
                        }
                    ],
                    silent: true
                }
            },
            {
                name: '本次成绩',
                type: 'bar',
                data: dataCurrent,
                itemStyle: { color: '#4285f4' }, // 蓝色
                // [!!] 添加平均分辅助线
                markLine: {
                    symbol: 'none',
                    data: [
                        {
                            name: '本次平均分',
                            xAxis: (currStats.avg - startBin) / binSize,
                            lineStyle: { color: '#4285f4', type: 'dashed', width: 2 },
                            label: { formatter: '本次均分\n{c}', position: 'end' },
                            value: currStats.avg
                        }
                    ],
                    silent: true
                }
            }
        ]
    };
    echartsInstances[elementId].setOption(option);
}




/**
 * (新增) 10.24. 渲染临界生模块 - 单个学生科目详情
 * [!!] (已修改) - 不及格科目和分数均标红
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
 * (新增) 10.12. 渲染分层筛选 - 班级构成饼图
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
 * (新增) 10.13. 渲染分层筛选 - 群体能力雷达图
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

    // 1. (关键) 重新计算这个 "筛选群体" 的统计数据
    // [!!] 复用 calculateAllStatistics 函数
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

    // 3. (新增) 获取 "筛选群体" 的得分率 (即难度)
    const groupData = G_DynamicSubjectList.map(subject => {
        return groupStats[subject]?.difficulty || 0;
    });

    // 4. (新增) 获取 "全体平均" 的得分率 (即难度)
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
 * (新增) 10.14. [辅助函数] 计算皮尔逊相关系数
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
 * (新增) 10.20. 渲染单科A/B/C/D等级构成饼图
 */
function renderSingleSubjectPie(elementId, subjectStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // [!!] 从 stats 中获取 A, B, C, D 的比率
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
            // [!!] (新增) 颜色映射
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
// (新增) 10.21. 渲染不及格科目数条形图
// ---------------------------------
// [!!] (修改) 接收 failureData (对象) 而不是 failureCounts (数字)
function renderFailureCountChart(elementId, failureData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // [!!] (修改) 从 failureData 计算 labels 和 data
    const labels = Object.keys(failureData).sort((a, b) => a - b); // ['0', '1', '2']
    const data = labels.map(key => {
        const students = failureData[key] || [];
        return {
            value: students.length, // [!!] (修改) value 是数组长度
            names: students.map(s => s.name) // [!!] (新增) 存储姓名用于 tooltip
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
                // [!!] (修改) Tooltip 显示姓名
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
            data: categoryLabels, // [!!] (修改)
            name: '不及格科目数'
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: data, // [!!] (修改)
            barWidth: '60%',
            label: {
                show: true,
                position: 'top'
            },
            itemStyle: {
                color: (params) => {
                    // [!!] (修改) 解析 '0 科'
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
    return echartsInstances[elementId]; // [!!] (新增) 返回实例
}

/**
 * 渲染排名流动桑基图 (修复颜色版)
 * [!!] 修复点：为不同的排名层级分配了不同的颜色，不再全显示为灰色
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

    // [!!] 1. 定义颜色盘 (对应 rankTiers 的顺序)
    // 顺序：Top 10% (蓝), 10-30% (橙), 30-60% (绿), Bottom 40% (红/粉)
    const tierColors = ['#5470c6', '#fac858', '#91cc75', '#ee6666'];

    // 2. ECharts Nodes
    const nodes = [];

    // [!!] 修复：在生成节点时分配颜色
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
                color: 'gradient', // [!!] 恢复渐变色 (依赖 source 和 target 的颜色)
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
 * (新增) 11.1. 计算所有班级的统计数据 (用于班级对比)
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
 * (新增) 10.25. (ECharts) 渲染多次考试曲线图 (通用)
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
            inverse: yAxisInverse, // [!!] (排名图需要反转)
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
 * 修复了读取字符串可能导致崩溃的问题
 */
async function loadDataFromStorage() {
    console.log("🚀 系统启动：正在连接 IndexedDB 加载数据...");

    try {
        // 并行读取数据
        const [
            storedData,
            storedCompareData,
            storedConfigs,
            storedMainFile,
            storedCompareFile
        ] = await Promise.all([
            localforage.getItem('G_StudentsData'),
            localforage.getItem('G_CompareData'),
            localforage.getItem('G_SubjectConfigs'),
            localforage.getItem('G_MainFileName'),
            localforage.getItem('G_CompareFileName')
        ]);

        // 2. 如果没有“本次成绩”，则什么也不做
        if (!storedData) {
            console.log("📭 本地存储为空，等待用户导入...");
            initializeSubjectConfigs();
            return;
        }

        // [!! 核心修复 !!] 检查数据类型，如果是字符串(降级保存的结果)，必须解析
        // -----------------------------------------------------------
        if (typeof storedData === 'string') {
            console.log("⚠️ 检测到字符串格式的本次成绩，正在解析...");
            G_StudentsData = JSON.parse(storedData);
        } else {
            G_StudentsData = storedData;
        }

        // 同样检查对比数据
        if (storedCompareData) {
            if (typeof storedCompareData === 'string') {
                console.log("⚠️ 检测到字符串格式的对比成绩，正在解析...");
                G_CompareData = JSON.parse(storedCompareData);
            } else {
                G_CompareData = storedCompareData;
            }
        }
        // -----------------------------------------------------------

        console.log(`✅ 成功加载本次成绩：${G_StudentsData.length} 条记录`);

        // 4. 重建 G_DynamicSubjectList (确保科目列表正确)
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

        // 5. 加载配置
        if (storedConfigs) {
            G_SubjectConfigs = storedConfigs;
        } else {
            initializeSubjectConfigs();
        }

        // 6. 健壮性检查：确保所有科目都有配置
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

        // 7. UI 更新
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

        // 9. 运行分析
        runAnalysisAndRender();

    } catch (err) {
        console.error("❌ IndexedDB 读取严重失败:", err);
        alert("读取缓存数据出错。如果问题持续，请点击左下角的“清除所有导入数据”按钮重置系统。");
    }
}

/**
 * (新增) 11.2. (重构) 渲染“多次考试”的UI列表
 */
function renderMultiExamList(multiExamData) {
    const listContainer = document.getElementById('multi-exam-list');
    if (!listContainer) return;

    if (!multiExamData || multiExamData.length === 0) {
        listContainer.innerHTML = `<li class="multi-exam-item-empty">暂无数据，请点击“添加新成绩”上传。</li>`;
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

    // 2. 更新当前集合的 exams
    if (collections[G_CurrentCollectionId]) {
        collections[G_CurrentCollectionId].exams = examArray;

        // 3. 保存回 LocalStorage
        await saveCollections(collections);

        // 4. 顺便更新一下下拉框显示的考试数量
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
    // (增加容错：如果当前ID不对，默认返回空数组)
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
 * (重构) 11.5. 初始化“多次考试分析”的学生搜索框
 * [!!] (已修改) 添加了筛选器的事件监听
 */
function initializeStudentSearch(multiExamData) {
    const searchInput = document.getElementById('multi-student-search');
    const resultsContainer = document.getElementById('multi-student-search-results');
    const reportContainer = document.getElementById('multi-student-report');

    if (!searchInput) return; // (如果不在当前模块, DOM不存在)

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

    // (点击搜索结果 事件 - [!!] 修改)
    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item && item.dataset.id) {
            const studentId = item.dataset.id;
            const studentName = item.querySelector('strong').innerText;

            searchInput.value = `${studentName} (${studentId})`;
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';

            document.getElementById('multi-student-name-title').innerText = `${studentName} 的成绩曲线`;
            reportContainer.style.display = 'block';

            // [!!] (新增) 存储当前学生ID，以便筛选器使用
            reportContainer.dataset.studentId = studentId;

            // (调用新函数)
            drawMultiExamChartsAndTable(studentId, loadMultiExamData(), true); // [!!] true = 强制重绘复选框
        }
    });

    // (点击外部 隐藏 - 不变)
    document.addEventListener('click', (e) => {
        if (searchInput && !searchInput.contains(e.target) && resultsContainer && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    // [!!] (新增) 绑定筛选器事件
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    const selectAllBtn = document.getElementById('multi-subject-all');
    const selectNoneBtn = document.getElementById('multi-subject-none');

    // (辅助函数：重绘图表)
    const redrawCharts = () => {
        const currentStudentId = reportContainer.dataset.studentId;
        if (currentStudentId) {
            drawMultiExamChartsAndTable(currentStudentId, loadMultiExamData(), false); // [!!] false = 不重绘复选框
        }
    };

    // (复选框点击事件 - 委托)
    if (checkboxContainer) {
        checkboxContainer.addEventListener('change', redrawCharts);
    }

    // (全选)
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            redrawCharts();
        });
    }

    // (全不选)
    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', () => {
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            redrawCharts();
        });
    }
}


/**
 * (重构) 11.6. (核心) 绘制多次考试的图表和表格
 * [!! 修复版 !!] 解决缺考科目显示排名的问题
 */
function drawMultiExamChartsAndTable(studentId, multiExamData, forceRepopulateCheckboxes = false) {

    // 1. 过滤与准备数据 (不变)
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

    let studentNameForPrint = "学生";

    // 2. 填充数据
    visibleExamData.forEach(exam => {
        const student = exam.students.find(s => String(s.id) === String(studentId));
        if (student) {
            if (studentNameForPrint === "学生") studentNameForPrint = student.name;

            rankData.classRank.push(student.rank || null);
            rankData.gradeRank.push(student.gradeRank || null);

            dynamicSubjects.forEach(subject => {
                const rawScore = student.scores[subject];
                // [!! 修复 1] 只有当 rawScore 严格为 null/undefined 时才存为 null (保留 0 分)
                subjectData[subject].push((rawScore !== null && rawScore !== undefined) ? rawScore : null);

                // [!! 修复 2] 核心逻辑：只有当有有效分数时，才获取排名
                // 如果分数是 N/A，那么排名强制设为 null，不读取系统自动生成的“倒数第一”排名
                let classRank = null;
                let gradeRank = null;

                if (typeof rawScore === 'number' && !isNaN(rawScore)) {
                    classRank = student.classRanks ? student.classRanks[subject] : null;
                    gradeRank = student.gradeRanks ? student.gradeRanks[subject] : null;
                }

                subjectRankData[subject].classRank.push(classRank);
                subjectRankData[subject].gradeRank.push(gradeRank);
            });
        } else {
            // 学生没参加这次考试，全部填 null
            rankData.classRank.push(null);
            rankData.gradeRank.push(null);
            dynamicSubjects.forEach(subject => {
                subjectData[subject].push(null);
                subjectRankData[subject].classRank.push(null);
                subjectRankData[subject].gradeRank.push(null);
            });
        }
    });

    // 3. [图表1 数据] 分数 (不变)
    const scoreSeries = [];
    dynamicSubjects.forEach(subject => {
        scoreSeries.push({
            name: subject,
            type: 'line',
            data: subjectData[subject],
            smooth: true,
            connectNulls: true
        });
    });

    // 4. 复选框逻辑 (不变)
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    if (checkboxContainer && forceRepopulateCheckboxes) {
        checkboxContainer.innerHTML = dynamicSubjects.map(subject => `
            <div>
                <input type="checkbox" id="multi-cb-${subject}" value="${subject}" checked>
                <label for="multi-cb-${subject}">${subject}</label>
            </div>
        `).join('');
    }
    const checkedSubjects = new Set();
    if (checkboxContainer) {
        checkboxContainer.querySelectorAll('input:checked').forEach(cb => checkedSubjects.add(cb.value));
    }
    const filteredScoreSeries = scoreSeries.filter(series => checkedSubjects.has(series.name));

    // 5. [图表2 数据] 总分排名 (不变)
    const totalRankSeries = [];
    totalRankSeries.push({
        name: '班级排名 (总)',
        type: 'line',
        data: rankData.classRank,
        smooth: true,
        connectNulls: true
    });
    totalRankSeries.push({
        name: '年级排名 (总)',
        type: 'line',
        data: rankData.gradeRank,
        smooth: true,
        connectNulls: true
    });

    // 6. 渲染 图表1 & 图表2 (不变)
    renderMultiExamLineChart('multi-exam-score-chart', '', examNames, filteredScoreSeries, false);
    renderMultiExamLineChart('multi-exam-rank-chart', '', examNames, totalRankSeries, true);

    // 7. 渲染 图表3 (不变，调用新函数)
    const rankTypeSelect = document.getElementById('multi-rank-type-select');
    const rankType = rankTypeSelect ? rankTypeSelect.value : 'both';

    renderSubjectRankChart(
        'multi-exam-subject-rank-chart',
        examNames,
        visibleExamData,
        studentId,
        checkedSubjects,
        rankType
    );

    // 8. 绘制表格 (含打印按钮) [!! 修改渲染模板]
    const tableContainer = document.getElementById('multi-student-table-container');
    if (!tableContainer) return;

    // 辅助函数：安全显示数据 (0分显示0，null显示N/A)
    const safeVal = (v) => (v !== null && v !== undefined) ? v : 'N/A';

    let tableHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-top: 20px; border-top: 1px solid var(--border-color);">
            <h4 style="margin: 0;">成绩详情表</h4>
            <button id="multi-print-table-btn" class="sidebar-button" style="font-size: 0.9em; padding: 6px 12px; background-color: var(--color-blue);">
                🖨️ 打印表格
            </button>
        </div>
        <div class="table-container" id="multi-print-table-content" style="max-height: 400px;">
            <table>
                <thead>
                    <tr>
                        <th style="min-width: 120px;">考试名称</th>
                        <th>班级排名 (总)</th>
                        <th>年级排名 (总)</th>
                        ${dynamicSubjects.map(s => `<th>${s} (分数)</th>`).join('')}
                        ${dynamicSubjects.map(s => `<th>${s} (班排)</th>`).join('')}
                        ${dynamicSubjects.map(s => `<th>${s} (年排)</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${examNames.map((examName, index) => `
                        <tr>
                            <td><strong>${examName}</strong></td>
                            <td>${safeVal(rankData.classRank[index])}</td>
                            <td>${safeVal(rankData.gradeRank[index])}</td>
                            ${dynamicSubjects.map(subject => `
                                <td>${safeVal(subjectData[subject][index])}</td>
                            `).join('')}
                            ${dynamicSubjects.map(subject => `
                                <td>${safeVal(subjectRankData[subject].classRank[index])}</td>
                            `).join('')}
                            ${dynamicSubjects.map(subject => `
                                <td>${safeVal(subjectRankData[subject].gradeRank[index])}</td>
                            `).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    tableContainer.innerHTML = tableHtml;

    const printBtn = document.getElementById('multi-print-table-btn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            const contentToPrint = document.getElementById('multi-print-table-content').innerHTML;
            startMultiTablePrintJob(studentNameForPrint, contentToPrint);
        });
    }
}

/**
 * (新增) 11.7. 打开“导入来源”模态框
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
// [!! NEW !!] 模块十三：学科小题分析
// =====================================================================

/**
 * 13.1. 渲染模块十三 (学科小题分析) 的主界面
 * * [!! 修正版 15 !!] - 2025-11-12
 * - (Feature) 新增“题目-学生 诊断散点图”的 HTML 框架和下拉框。
 * - (Refactor) 更新事件监听器以包含新图表。
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

            <div id="item-kpi-grid" class="kpi-grid" style="margin-bottom: 20px;"></div>
            
            
            <h3 style="margin-top: 30px;">📊 各大题 (文字/字母) 分析</h3>
            <div class="main-card-wrapper" style="gap: 20px; margin-bottom: 20px;">
                <div class="controls-bar chart-controls" style="padding: 0; border: none;">
                    <label for="item-major-metric-select">选择指标:</label>
                    <select id="item-major-metric-select" class="sidebar-select" style="width: auto;">
                        <option value="difficulty">难度 (得分率)</option>
                        <option value="discrimination">区分度</option>
                    </select>
                </div>
                <div class="chart-container" id="item-chart-major" style="height: 400px;"></div>
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
    const scatterQSelect = document.getElementById('item-scatter-question-select'); // [!! NEW !!]


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

    // 4. 绑定文件上传事件 (不变)
    uploader.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        statusLabel.innerText = `🔄 正在解析 ${file.name}...`;
        try {
            const itemData = await loadItemAnalysisExcel(file);
            G_ItemAnalysisData = itemData;

            // [修改] 保存到 IndexedDB (这是最关键的优化)
            await localforage.setItem('G_ItemAnalysisData', itemData);
            await localforage.setItem('G_ItemAnalysisFileName', file.name);

            const subjects = Object.keys(itemData);
            if (subjects.length === 0) {
                throw new Error("在文件中未找到任何包含有效数据的工作表。");
            }
            // [!! 修改 !!] 显示文件名
            statusLabel.innerText = `✅ 已加载: ${file.name} (共 ${subjects.length} 科)`;
            populateItemAnalysisUI(itemData);
        } catch (err) {
            console.error(err);
            statusLabel.innerText = `❌ 解析失败: ${err.message}`;
            alert(`解析失败: ${err.message}`);
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

    // [!! 修正 !!] 班级筛选器 (主触发器)
    classFilter.addEventListener('change', () => {
        renderItemAnalysisCharts(); // 重绘所有 (KPIs 和新图表需要)
    });

    // [!! 修正 !!] (高效触发器)
    layerGroupSelect.addEventListener('change', () => {
        // 只重绘依赖分层的图表
        drawItemAnalysisLayeredChart();
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

    // 10. [!! NEW (Feature) !!] 绑定新散点图的下拉框
    scatterQSelect.addEventListener('change', () => {
        drawItemScatterQuadrantChart();
    });

    const itemPrintBtn = document.getElementById('item-print-btn');
    if (itemPrintBtn) {
        // [!! 核心 !!] 按钮点击时，调用新的多功能打印函数
        itemPrintBtn.addEventListener('click', startItemDetailPrintJob);
    }

    // 11. 绑定配置按钮和模态框事件
    configBtn.addEventListener('click', populateItemAnalysisConfigModal);
    document.getElementById('item-config-modal-close-btn').addEventListener('click', () => {
        document.getElementById('item-analysis-config-modal').style.display = 'none';
    });
    document.getElementById('item-config-modal-save-btn').addEventListener('click', () => {
        saveItemAnalysisConfigFromModal();
        renderItemAnalysisCharts(); // [!!] 保存配置后重绘所有
    });

    // 12. 模块加载时：尝试从缓存加载 (!! 修改：包裹在 async 箭头函数中 !!)
    (async () => {
        try {
            const statusLabel = document.getElementById('item-analysis-status'); // 确保获取到 statusLabel

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

                // [!!] 如果有文件名，就显示文件名；否则显示默认提示
                if (storedFileName) {
                    statusLabel.innerText = `✅ 已加载: ${storedFileName}`;
                } else {
                    statusLabel.innerText = "✅ 已从数据库加载数据。";
                }

                populateItemAnalysisUI(G_ItemAnalysisData);
            } else {
                statusLabel.innerText = "请导入小题分明细 Excel。";
            }
        } catch (e) {
            console.error("加载小题分缓存失败:", e);
            const statusLabel = document.getElementById('item-analysis-status');
            if (statusLabel) statusLabel.innerText = "缓存加载失败，请重新导入。";

            // 出错时清理可能损坏的数据
            localforage.removeItem('G_ItemAnalysisData');
            localforage.removeItem('G_ItemAnalysisConfig');
        }
    })();
}

/**
 * 13.2. [核心] 解析小题分 Excel 文件
 * * [!! 修正版 7 !!] - 2025-11-11
 * - (Bug) 增加了 .slice(..., -3) 来移除最后三行非学生数据。
 * - (其余 Bug 修复保持不变)
 */
function loadItemAnalysisExcel(file) {
    return new Promise((resolve, reject) => {

        // [!! 内部辅助函数 !!] (不变)
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

                    if (rawData.length < 5) { // (至少1表头 + 1数据 + 3统计行)
                        console.warn(`工作表 "${sheetName}" 数据行数不足，已跳过。`);
                        continue;
                    }

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
                    const isMinorQuestion = /^\d/; // (以数字开头)
                    let foundTotalScore = false;

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

                    // 4. 解析学生数据行
                    // [!! 修正 !!] (Bug) 移除最后三行 (非学生数据)
                    const studentRows = rawData.slice(studentDataStartRow, -3);
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

                        // [!! 修正 !!] 确保学生有姓名 和 有效的总分
                        if (student.id && hasName && student.totalScore !== null) {
                            processedData.push(student);
                        }
                    }

                    if (processedData.length === 0) {
                        console.warn(`工作表 "${sheetName}" 解析完成，但未找到有效学生数据。`);
                        continue;
                    }

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
 * * [!! 修正版 15 !!] - 2025-11-12
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
        document.getElementById('item-chart-scatter-quadrant').innerHTML = ""; // [!! NEW !!]
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

    const recalculatedStats = getRecalculatedItemStats(selectedSubject); // [!! 修正 Bug !!]
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

    // 4. [!! NEW (Feature) !!] 填充散点图的题目下拉框
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
        drawItemAnalysisKnowledgeChart();
        drawItemAnalysisOutlierTable();
        drawItemScatterQuadrantChart(); // [!! NEW !!]
    }, 0);
}

/**
 * 13.4. (ECharts) 渲染小题分析条形图 (带缩放)
 * * [!! 修正版 3 !!] - (此函数保持不变)
 * - (Bug 1) 增加了对 qNames 的空值检查。
 * - (Bug 1) 修正了当 qNames.length 为 0 时，end 属性计算为 Infinity 的问题。
 */
function renderItemAnalysisBarChart(elementId, title, qNames, data, yAxisRange) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    // [!! 修正 !!] (Bug 1)
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
                return `<strong>题号: ${p.name}</strong><br/>数值: ${p.value.toFixed(3)}`; // [!!] 修正错字
            }
        },
        grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
        xAxis: {
            type: 'category',
            data: qNames,
            name: '题号', // [!!] 修正错字
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
// [!! NEW !!] 模块十三：新功能函数 (Feature 2 & 3)
// =====================================================================

/**
 * 13.5. [NEW] (Feature 3) 
 * 获取重新计算后的统计数据 (应用了用户配置的满分)
 */
function getRecalculatedItemStats(subjectName) {
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return { minorStats: {}, majorStats: {}, minorQuestions: [], majorQuestions: [] };
    }

    // 1. 获取原始数据和配置
    const rawData = G_ItemAnalysisData[subjectName];
    const config = G_ItemAnalysisConfig[subjectName] || {};

    // 2. 创建新的统计对象
    const newMinorStats = {};
    const newMajorStats = {};

    // 3. 循环小题 (minor)
    (rawData.minorQuestions || []).forEach(qName => {
        const rawStat = rawData.minorStats[qName];
        if (!rawStat) return;

        const qConfig = config[qName] || {};

        // [!! 核心 !!] 满分 = 手动配置的满分 || 自动检测的满分
        const fullScore = qConfig.fullScore || rawStat.maxScore;
        const avg = rawStat.avg;

        // [!! 核心 !!] 重新计算难度
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
 * 13.6. [NEW] (Feature 2) 
 * 绘制单个小题/大题图表 (根据下拉框选择)
 */
function drawItemAnalysisChart(type) { // type is 'minor' or 'major'
    const subjectName = document.getElementById('item-subject-select').value;
    if (!subjectName) return;

    // 1. 获取重新计算后的统计数据 (已应用配置)
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
 * 13.7. [增强版] 填充配置弹窗 (支持回显试卷文本)
 */
function populateItemAnalysisConfigModal() {
    const subjectName = document.getElementById('item-subject-select').value;
    if (!subjectName) { alert("无可用科目！"); return; }

    const rawData = G_ItemAnalysisData[subjectName];
    const subjectConfig = G_ItemAnalysisConfig[subjectName] || {};
    const recalculatedStats = getRecalculatedItemStats(subjectName);

    const tableBody = document.getElementById('item-config-table-body');
    const paperTextarea = document.getElementById('item-config-full-paper'); // [!!] 获取文本框

    // [!! NEW !!] 回显已保存的试卷文本
    // 我们使用一个特殊的 key "_full_paper_context_" 来存储试卷文本
    paperTextarea.value = subjectConfig['_full_paper_context_'] || "";

    let html = '';
    const createRow = (qName, type, stat) => {
        if (!stat) return '';
        const qConfig = subjectConfig[qName] || {};
        const autoFull = stat.maxScore;
        const manualFull = qConfig.fullScore || '';
        const content = qConfig.content || '';

        return `
            <tr data-q-name="${qName}">
                <td><strong>${qName}</strong> (${type})</td>
                <td><input type="number" class="item-config-full" placeholder="自动: ${autoFull}" value="${manualFull}" style="width: 80px;"></td>
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
 * 13.8. [增强版] 保存配置弹窗 (支持保存试卷文本)
 */
function saveItemAnalysisConfigFromModal() {
    const modal = document.getElementById('item-analysis-config-modal');
    const subjectName = modal.dataset.subjectName;
    if (!subjectName) return;

    let allConfigs = G_ItemAnalysisConfig;
    let subjectConfig = allConfigs[subjectName] || {};

    // [!! NEW !!] 保存试卷文本到特殊字段
    const fullPaperText = document.getElementById('item-config-full-paper').value;
    subjectConfig['_full_paper_context_'] = fullPaperText;

    // 保存题目配置
    const rows = document.getElementById('item-config-table-body').querySelectorAll('tr');
    rows.forEach(row => {
        const qName = row.dataset.qName;
        const manualFullInput = row.querySelector('.item-config-full').value;
        const contentInput = row.querySelector('.item-config-content').value;
        const manualFull = parseFloat(manualFullInput);

        subjectConfig[qName] = {
            fullScore: (!isNaN(manualFull) && manualFull > 0) ? manualFull : undefined,
            content: contentInput || undefined
        };
    });

    allConfigs[subjectName] = subjectConfig;
    G_ItemAnalysisConfig = allConfigs;
    localforage.setItem('G_ItemAnalysisConfig', allConfigs);

    modal.style.display = 'none';
    renderItemAnalysisCharts();
    alert("配置已保存！(试卷内容已连接至 AI 模块)");
}

// =====================================================================
// [!! NEW !!] 模块十三：分层对比图 (Feature 4)
// =====================================================================

/**
 * 13.9. [MODIFIED] (Feature 4) 
 * 计算分层后的小题统计数据
 * * [!! 修正版 12 !!] - 2025-11-11
 * - (Bug 修复) 修正了 groupStats (层均分) 只计算了小题，未计算大题的问题。
 * - (Bug 修复) 这导致了学生详情表中大题的 "层均得分率" 和 "偏差" 显示为 NaN。
 */
function calculateLayeredItemStats(subjectName, numGroups, filteredStudents) {
    // 1. 获取原始学生数据 (已在外部筛选)
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return { groupStats: {}, qNames: [], overallDifficulty: {} };
    }
    const rawData = G_ItemAnalysisData[subjectName];

    // [!! 修正 !!] "qNames" 仅用于小题图表X轴，保持不变
    const qNames = rawData.minorQuestions || [];

    // 2. 获取重新计算后的 "满分" 配置
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

    // 5. [!! 修正 !!] (Bug 修复) 计算 *所有* 题目的层均分
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
                studentGroups.forEach((_, index) => {
                    const groupName = `G${index + 1}`;
                    if (!groupStats[groupName]) groupStats[groupName] = {};
                    groupStats[groupName][qName] = 0;
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

    // [!! 修正 !!] (Bug 修复) 同时计算小题和大题
    calculateGroupRates(rawData.minorQuestions, 'minorScores', 'minorStats');
    calculateGroupRates(rawData.majorQuestions, 'majorScores', 'majorStats');

    // 6. [!! 不变 !!] (Bug 修复)
    // "overallDifficulty" 仅用于小题对比图的柱状图，所以 *只* 计算小题
    qNames.forEach(qName => {
        overallDifficulty[qName] = recalculatedStats.minorStats[qName]?.difficulty || 0;
    });

    return { groupStats, qNames, overallDifficulty };
}

/**
 * 13.10. [MODIFIED] (Feature 4) 
 * 绘制小题得分率分层对比图
 * * [!! 修正版 11 !!] - 2025-11-11
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

    // [!! 修正 !!] (Bug 修复) 添加 notMerge: true
    echartsInstances['item-chart-layered'].setOption(option, { notMerge: true });
}

// =====================================================================
// [!! NEW !!] 模块十三：知识点分层图 (Feature 5)
// =====================================================================

/**
 * 13.11. [FIXED] 计算分层后的知识点统计数据
 * [!!] 修改：使用中文分号 "；" 或英文分号 ";" 作为分隔符
 */
function calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents, questionType = 'all') {
    // 1. 获取基础数据
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return { groupStats: {}, knowledgePoints: [], studentsWithRates: [] };
    }
    const rawData = G_ItemAnalysisData[subjectName];
    const subjectConfig = G_ItemAnalysisConfig[subjectName] || {};

    // 2. [核心] 构建知识点列表 (仅用于生成表头和初始化)
    const knowledgeSet = new Set();
    for (const qName in subjectConfig) {
        const content = subjectConfig[qName]?.content;
        if (content) {
            // [!! 修改 !!] 使用正则同时匹配 中文分号(；) 和 英文分号(;)
            const kps = content.split(/[;；]/).map(k => k.trim()).filter(k => k);
            kps.forEach(k => knowledgeSet.add(k));
        }
    }
    const knowledgePoints = Array.from(knowledgeSet).sort();

    if (knowledgePoints.length === 0) {
        return { groupStats: {}, knowledgePoints: [], studentsWithRates: [] };
    }

    // 3. 获取重新计算后的满分
    const recalculatedStats = getRecalculatedItemStats(subjectName);

    // 4. 获取排序后的学生
    const validStudents = (filteredStudents || [])
        .filter(s => typeof s.totalScore === 'number' && !isNaN(s.totalScore))
        .sort((a, b) => b.totalScore - a.totalScore);

    if (validStudents.length === 0) {
        return { groupStats: {}, knowledgePoints: knowledgePoints, studentsWithRates: [] };
    }

    // 5. 计算每个学生在每个知识点上的得分率
    validStudents.forEach(student => {
        student.knowledgeRates = {};
        const aggregates = {};
        // 初始化所有知识点的累加器
        knowledgePoints.forEach(kp => { aggregates[kp] = { totalGot: 0, totalPossible: 0 }; });

        // --- 辅助函数：处理单道题目的分数累加 ---
        const processQuestion = (qName, statsType, scoreType) => {
            const qContent = subjectConfig[qName]?.content || "";

            // [!! 修改 !!] 解析该题对应的所有知识点 (同样支持两种分号)
            const qKps = qContent.split(/[;；]/).map(k => k.trim()).filter(k => k);

            if (qKps.length > 0) {
                const stat = recalculatedStats[statsType][qName];
                const score = student[scoreType][qName];
                const fullScore = stat?.manualFullScore || stat?.maxScore;

                // 如果分数有效且满分>0
                if (typeof score === 'number' && !isNaN(score) && fullScore > 0) {
                    // 将该题的分数贡献给它所属的每一个知识点
                    qKps.forEach(targetKp => {
                        if (aggregates[targetKp]) {
                            aggregates[targetKp].totalGot += score;
                            aggregates[targetKp].totalPossible += fullScore;
                        }
                    });
                }
            }
        };

        // (A) 筛选小题
        if (questionType === 'all' || questionType === 'minor') {
            (rawData.minorQuestions || []).forEach(qName => {
                processQuestion(qName, 'minorStats', 'minorScores');
            });
        }

        // (B) 筛选大题
        if (questionType === 'all' || questionType === 'major') {
            (rawData.majorQuestions || []).forEach(qName => {
                processQuestion(qName, 'majorStats', 'majorScores');
            });
        }

        // (C) 结算得分率
        for (const kp in aggregates) {
            const agg = aggregates[kp];
            // 得分率 = 总得分 / 总满分
            student.knowledgeRates[kp] = (agg.totalPossible > 0) ? (agg.totalGot / agg.totalPossible) : null;
        }
    });

    // 6. 将学生分层 (G1, G2, ...)
    const groupSize = Math.ceil(validStudents.length / numGroups);
    const studentGroups = [];
    for (let i = 0; i < numGroups; i++) {
        const group = validStudents.slice(i * groupSize, (i + 1) * groupSize);
        if (group.length > 0) {
            studentGroups.push(group);
        }
    }

    // 7. 计算每层在每个知识点上的平均得分率
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

    return { groupStats, knowledgePoints, studentsWithRates: validStudents };
}


/**
 * 13.12. [MODIFIED] (Feature 5) 
 * 绘制知识点掌握情况分组柱状图
 * * [!! 修正版 10 !!] - 2025-11-11
 * - (Feature) 现在从DOM读取班级筛选器，并获取筛选后的学生。
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
    const selectedClass = document.getElementById('item-class-filter').value; // [!! NEW !!]
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);

    // [!! NEW (Feature) !!] 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. [核心] 计算分层数据 (传入筛选后的学生)
    const { groupStats, knowledgePoints } = calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents);

    if (knowledgePoints.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">未找到已配置“考查内容”的题目，请先点击“配置题目”。</p>`;
        return;
    }

    // 4. 准备 ECharts Series (不变)
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
            data: knowledgePoints.map(kp => {
                return parseFloat((groupStats[groupName][kp] || 0).toFixed(3));
            }),
            color: lineColors[index % lineColors.length]
        });
    });

    // 5. ECharts 配置 (不变)
    const option = {
        title: {
            text: '知识点掌握情况 (按总分分层)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { data: legendData, top: 30, type: 'scroll' },
        grid: { left: '3%', right: '4%', bottom: '20%', top: 70, containLabel: true },
        xAxis: {
            type: 'category',
            data: knowledgePoints,
            name: '知识点 (考察内容)',
            axisLabel: { interval: 'auto', rotate: 30 }
        },
        yAxis: { type: 'value', name: '得分率', min: 0, max: 1 },
        dataZoom: [
            {
                type: 'slider',
                xAxisIndex: [0],
                start: 0,
                end: (knowledgePoints.length > 20) ? (20 / knowledgePoints.length * 100) : 100,
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
// [!! NEW !!] 模块十三：学生个体诊断表 (Feature 6)
// =====================================================================

/**
 * 13.13. [MODIFIED] (Feature 6) 
 * 计算学生知识点偏差（短板/亮点）
 * * [!! 修正版 12 !!] - 2025-11-11
 * - (Feature) 签名变更，接收 studentsWithRates。
 * - (Refactor) 移除了重复的学生获取和得分率计算。
 */
function calculateStudentKnowledgeOutliers(subjectName, numGroups, groupStats, knowledgePoints, studentsWithRates, questionType = 'all') {
    // 1. 获取基础数据 (已在外部筛选)
    if (!G_ItemAnalysisData || !G_ItemAnalysisData[subjectName]) {
        return [];
    }

    // 2. [!! 修正 !!] (Refactor) 直接使用传入的 studentsWithRates
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

            // [!! 修正 !!] 只有当学生和层级都有有效得分率时才比较
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
 * * [!! 修正版 12 !!] - 2025-11-11
 * - (Feature) 新增读取 "题目类型" (questionType) 筛选器。
 * - (Feature) 将 questionType 传递给计算函数。
 */
function drawItemAnalysisOutlierTable() {
    const tableContainer = document.getElementById('item-outlier-table-container');
    if (!tableContainer) return;

    const detailContainer = document.getElementById('item-student-detail-container');
    if (detailContainer) detailContainer.style.display = 'none';

    // [!! 新增 (One Button) !!] 重置打印按钮
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
    const questionType = document.getElementById('item-outlier-type-filter').value; // [!! NEW !!]

    // 2. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 3. [核心] 先调用知识点分层统计
    // [!! 修正 !!] 传递 questionType
    const { groupStats, knowledgePoints, studentsWithRates } = calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents, questionType);

    if (knowledgePoints.length === 0) {
        tableContainer.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 20px;">未找到已配置“考察内容”的题目，无法生成诊断表。</p>`;
        G_ItemOutlierList = [];
        return;
    }

    // 4. [核心] 再调用偏差计算
    // [!! 修正 !!] 传递 questionType 和 studentsWithRates
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
// [!! NEW !!] 模块十三：班级筛选辅助函数 (Feature 1)
// =====================================================================

/**
 * 13.15. [NEW] (Feature 1) 
 * 填充模块十三的班级筛选器
 */
function populateItemClassFilter(allStudents) {
    const classFilterSelect = document.getElementById('item-class-filter');
    if (!classFilterSelect) return;

    // 1. 获取当前选中的值 (以便在刷新时保留)
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
// [!! NEW !!] 模块十三：学生个体-题目详情表 (Feature 7)
// =====================================================================

/**
 * 13.16. [MODIFIED] (Feature 7) 
 * 绘制学生个体-题目详情表
 * * [!! 修正版 14 !!] - 2025-11-11
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
            kp: kp || 'N/A', // [!! 修正 !!] 确保N/A
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

    // 7. [!! 修正 (Feature) !!] 按 G_ItemDetailSort 排序
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

    // 9. [!! NEW (Feature) !!] 应用排序样式
    const th = detailContainer.querySelector(`th[data-sort-key="${G_ItemDetailSort.key}"]`);
    if (th) {
        th.classList.add(G_ItemDetailSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    // 10. (显示)
    detailContainer.style.display = 'block';

    // [!!] 在这里添加第 3 个代码片段
    // 11. [!! 修改 (One Button) !!] 更新打印按钮状态
    const printBtn = document.getElementById('item-print-btn');
    if (printBtn) {
        printBtn.innerText = `🖨️ 打印 ${studentName}`;
        printBtn.dataset.printTarget = 'current'; // 设为"当前"模式
        printBtn.dataset.studentId = studentId; // 存储ID
    }
}

// =====================================================================
// [!! NEW !!] 模块十三：题目-学生 四象限图 (Feature 8)
// =====================================================================

/**
 * 13.17. [NEW] (Feature 8) 
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

    // 4. [!! 核心 !!] 计算 *筛选后学生* 的平均题分和平均总分
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

    // 5. [!! 核心 !!] 计算 Y 轴最大值 (卷面总分)
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
        TR: '#f56c6c', // (右上) 尖子生 - (重点关注) -> [!!] (您的图片中，右上是“短板”，但逻辑上应是右下)
        BR: '#dc3545', // (右下) 高总分, 低题分 -> [!!] (这才是“短板”，标红)
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
        // [!! 核心 !!] 十字象限线 和 标签
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

    // 8. [!! 核心 !!] 动态添加象限标签
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
// [!! NEW (Print Feature) !!] 模块二：打印引擎
// =====================================================================

/**
 * 1. [打印引擎-核心] 启动打印作业 (修复版)
 * * [!! 修正版 23 (数据读取修复) !!]
 * - (新增) 改为 async 函数，优先从 localforage 读取文件名，解决文件上传后打印显示 N/A 的问题。
 * - (保留) 所有的布局样式修复 (修正版 22)。
 */
async function startPrintJob(studentIds) {
    if (!studentIds || studentIds.length === 0) {
        alert("没有可打印的学生。");
        return;
    }

    // 1. [!! 核心修复 !!] 获取考试信息
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
                /* [!! (Bug Fix) !!] 
                   (将关键布局样式内置，防止加载延迟) 
                */
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }
                .student-card {
                    display: grid;
                    /* [!! 修复 2 !!] 强制5列布局 */
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
                /* [!! 关键样式结束 !!] */


                /* --- 打印机设置 --- */
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 2cm;
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        /* [!! 修复 1 !!] 移除了 padding-top: 130px; */
                    }
                    
                    /* [!! 修复 1 !!] 移除了 .print-header-fixed 规则 */
                    
                    .print-header-preview {
                        /* [!! 修复 1 !!] 让它在打印时显示 */
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

    // 5. 打开新窗口并打印 (保持1秒延迟)
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
 * 2. [打印引擎-辅助] 为单个学生生成报告的 HTML
 * [!! 最终同步版 !!] 
 * - 包含：赋分计算、T分显示、T分进退步对比、原始分进退步
 */
function generateStudentReportHTML(student) {
    if (!student) return '';

    // 1. 查找对比数据 (用于计算总分进退步)
    let oldStudent = null;
    let scoreDiff = 'N/A', rankDiff = 'N/A', gradeRankDiff = 'N/A';

    if (G_CompareData && G_CompareData.length > 0) {
        oldStudent = G_CompareData.find(s => String(s.id) === String(student.id));
    }

    if (oldStudent) {
        scoreDiff = (student.totalScore - oldStudent.totalScore).toFixed(2);
        rankDiff = oldStudent.rank - student.rank; // 排名减法：旧-新，正数为进步
        gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 'N/A';
    }

    // 2. 生成学生卡片 HTML (保持不变)
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
                <span>班级排名 (上次: ${oldStudent ? oldStudent.rank : 'N/A'})</span>
                <strong class="${rankDiff > 0 ? 'progress' : rankDiff < 0 ? 'regress' : ''}">
                    ${student.rank}
                    ${(rankDiff !== 'N/A' && oldStudent) ? `(${rankDiff > 0 ? '▲' : '▼'} ${Math.abs(rankDiff)})` : ''}
                </strong>
            </div>
            <div class="sc-grade-rank">
                <span>年级排名 (上次: ${oldStudent ? (oldStudent.gradeRank || 'N/A') : 'N/A'})</span>
                <strong class="${gradeRankDiff > 0 ? 'progress' : gradeRankDiff < 0 ? 'regress' : ''}">
                    ${student.gradeRank || 'N/A'}
                    ${(gradeRankDiff !== 'N/A' && oldStudent) ? `(${gradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(gradeRankDiff)})` : ''}
                </strong>
            </div>
        </div>
    `;

    // 3. [!! 核心 !!] 生成表格行 HTML (同步所有逻辑)
    const tableRowsHtml = G_DynamicSubjectList.map(subject => {
        let subjectScoreDiff = 'N/A';
        let subjectClassRankDiff = 'N/A';
        let subjectGradeRankDiff = 'N/A';

        // (A) 计算原始分/排名的进退步
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

        // (B) 计算赋分 (福建模式)
        const config = G_SubjectConfigs[subject] || {};
        const isAssignedSubject = config.isAssigned === true;
        let rankBasedScoreDisplay = '';

        if (isAssignedSubject) {
            // 获取该科目全体原始分，用于计算赋分
            const allScoresForSubject = G_StudentsData.map(s => s.scores[subject]);
            const fujianScore = calculateFujianAssignedScore(student.scores[subject], allScoresForSubject);
            rankBasedScoreDisplay = `<div style="font-size:0.85em; color:#6f42c1; margin-top:4px; font-weight:bold;">赋分: ${fujianScore}</div>`;
        } else {
            rankBasedScoreDisplay = `<div style="font-size:0.8em; color:#aaa; margin-top:4px;">(原始分)</div>`;
        }

        // (C) 获取 T分 & 计算 T分进退步
        const tScore = (student.tScores && student.tScores[subject]) ? student.tScores[subject] : 'N/A';
        let tScoreDiffHtml = '';

        if (oldStudent && oldStudent.tScores && oldStudent.tScores[subject]) {
            const oldTScore = oldStudent.tScores[subject];
            // 确保两个 T 分都有效
            if (tScore !== 'N/A' && oldTScore !== undefined && oldTScore !== null) {
                const diff = tScore - oldTScore;
                const diffAbs = Math.abs(diff).toFixed(1);

                if (diff > 0) {
                    tScoreDiffHtml = `<span class="progress" style="font-size:0.9em; margin-left:4px;">(▲${diffAbs})</span>`;
                } else if (diff < 0) {
                    tScoreDiffHtml = `<span class="regress" style="font-size:0.9em; margin-left:4px;">(▼${diffAbs})</span>`;
                }
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
                    ${student.classRanks ? (student.classRanks[subject] || 'N/A') : 'N/A'}
                    ${(oldStudent && subjectClassRankDiff !== 'N/A') ? `<span class="${subjectClassRankDiff > 0 ? 'progress' : subjectClassRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectClassRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectClassRankDiff)})</span>` : ''}
                </td>
                <td>
                    <div>
                        ${student.gradeRanks ? (student.gradeRanks[subject] || 'N/A') : 'N/A'}
                        ${(oldStudent && subjectGradeRankDiff !== 'N/A') ? `<span class="${subjectGradeRankDiff > 0 ? 'progress' : subjectGradeRankDiff < 0 ? 'regress' : ''}" style="font-size:0.8em">(${subjectGradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectGradeRankDiff)})</span>` : ''}
                    </div>
                    ${rankBasedScoreDisplay}
                </td>
            </tr>
        `;
    }).join('');

    // 4. 生成完整表格 HTML
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
// [!! NEW (Feature) !!] 模块十三：打印引擎 (One Button 完整版)
// =====================================================================

/**
 * 13.18. [NEW] 启动“小题分析-学生诊断表”的打印作业 (智能版)
 * (此函数由 "item-print-btn" 按钮直接调用)
 */
function startItemDetailPrintJob() {
    // 1. 找到打印按钮自己
    const printBtn = document.getElementById('item-print-btn');
    if (!printBtn) {
        alert("打印按钮未找到！");
        return;
    }

    // 2. [!! 核心 !!] 检查按钮的模式
    const target = printBtn.dataset.printTarget;
    let studentIdsToPrint = [];

    if (target === 'current') {
        // 模式A: 打印当前选中的学生
        const studentId = printBtn.dataset.studentId;
        if (studentId) {
            studentIdsToPrint = [studentId];
        }
    } else {
        // 模式B: 打印当前筛选的列表
        // G_ItemOutlierList 已经在 drawItemAnalysisOutlierTable 中被正确筛选
        studentIdsToPrint = G_ItemOutlierList.map(s => s.id);
    }

    if (studentIdsToPrint.length === 0) {
        alert("没有可打印的学生。");
        return;
    }

    // (如果打印列表超过20人，给一个提示)
    if (studentIdsToPrint.length > 20) {
        if (!confirm(`您即将打印 ${studentIdsToPrint.length} 份学生报告。\n这可能需要一些时间来生成，是否继续？`)) {
            return;
        }
    }

    // 3. [!! 核心 !!] 获取所有计算所需的上下文
    const subjectName = document.getElementById('item-subject-select').value;
    const selectedClass = document.getElementById('item-class-filter').value;
    const numGroups = parseInt(document.getElementById('item-layer-groups').value);
    const questionType = document.getElementById('item-outlier-type-filter').value;

    // 4. 获取筛选后的学生
    const allStudents = G_ItemAnalysisData[subjectName]?.students || [];
    const filteredStudents = (selectedClass === 'ALL')
        ? allStudents
        : allStudents.filter(s => s.class === selectedClass);

    // 5. [!! 核心计算 !!] (这会比较慢，但必须执行)
    const recalculatedStats = getRecalculatedItemStats(subjectName);
    const { groupStats, knowledgePoints, studentsWithRates } = calculateLayeredKnowledgeStats(subjectName, numGroups, filteredStudents, questionType);

    // 6. 构建打印页面的完整 HTML (复用 Module 2 的样式)
    let html = `
        <html>
        <head>
            <title>学生知识点诊断</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }
                .print-page-container {
                    padding: 2cm;
                }
                
                /* 基础表格样式 (来自 style.css) */
                .table-container { width: 100%; margin-top: 15px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { 
                    border: 1px solid #999; 
                    padding: 10px; 
                    text-align: center; 
                    font-size: 0.9em;
                }
                th { background-color: #f0f0f0; }
                
                /* 进/退步颜色 (来自 style.css) */
                .progress { color: #00a876 !important; }
                .regress { color: #e53935 !important; }
                
                /* 打印机设置 */
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 0; /* 我们用 padding: 2cm 控制 */
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .print-page-break {
                        page-break-before: always;
                    }
                }
                @media screen {
                    /* 预览样式 */
                    body { background-color: #EEE; }
                    .print-page-container {
                        background-color: #FFF;
                        width: 210mm;
                        min-height: 297mm;
                        margin: 20px auto;
                        box-shadow: 0 0 10px rgba(0,0,0,0.2);
                        box-sizing: border-box;
                    }
                }
            </style>
        </head>
        <body>
            <main class="print-content-wrapper">
    `;

    // 7. [!! 核心循环 !!]
    let printedCount = 0;
    for (let i = 0; i < studentIdsToPrint.length; i++) {
        const studentId = studentIdsToPrint[i];

        // (A) 找到学生和他们的层级
        const student = studentsWithRates.find(s => s.id === studentId);
        // (B) G_ItemOutlierList 是我们唯一能获取 "layer" 的地方
        const outlierData = G_ItemOutlierList.find(s => s.id === studentId);

        if (!student || !outlierData) continue;

        const studentLayer = outlierData.layer;
        const pageBreakClass = (printedCount === 0) ? '' : 'print-page-break';

        // (C) 生成该学生的报告 HTML
        html += `
            <div class="print-page-container ${pageBreakClass}">
                ${generateItemDetailReportHTML(student, studentLayer, subjectName, questionType, groupStats, recalculatedStats)}
            </div>
        `;
        printedCount++;
    }

    // 8. 关闭 HTML
    html += `
            </main>
        </body>
        </html>
    `;

    // 9. 打开新窗口并打印
    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 1000); // (使用1秒延迟确保CSS应用)
}


/**
 * 13.19. [NEW] (打印辅助函数) 生成单个学生的诊断报告HTML
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
 * 11.8. [NEW] 启动“多次考试-成绩详情表”的打印作业
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
 * 11.9. [NEW] 专门负责渲染“图表3：各科排名变化曲线”
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

            // [!! 核心逻辑 !!] 
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
                connectNulls: true // [!!] 跳过空值连接 (根据你的需求)
            });
        }
        if (rankType === 'both' || rankType === 'grade') {
            series.push({
                name: `${subject}-年排`,
                type: 'line',
                data: gradeRankData,
                smooth: true,
                connectNulls: true // [!!] 跳过空值连接
            });
        }
    });

    // 调用通用的绘图函数渲染 (反转Y轴: true)
    renderMultiExamLineChart(containerId, '', examNames, series, true);
}

// =====================================================================
// [!! NEW !!] 模块十四：AI 智能分析 (DeepSeek 集成)
// =====================================================================

// 1. 初始化 AI 模块 (Debug 增强版)
// 1. 初始化 AI 模块 (修复版：解决班级列表初始化问题)
async function initAIModule() {

    initPromptManager();

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

    // 加载 Key
    const savedKey = localStorage.getItem('G_DeepSeekKey');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        document.getElementById('ai-key-status').style.display = 'inline';
    }

    // 绑定按钮
    const sendFollowUpBtn = document.getElementById('ai-send-btn');
    if (sendFollowUpBtn) sendFollowUpBtn.addEventListener('click', sendAIFollowUp);
    const printReportBtn = document.getElementById('ai-print-btn');

    const printRangeBtn = document.getElementById('ai-print-range-btn');
    if (printRangeBtn) {
        printRangeBtn.addEventListener('click', () => {
            // 弹出输入框询问
            const input = prompt("请输入要打印的对话轮次 (例如 '1' 或 '1-3' 或 '2,4')：\n\n● 第 1 轮 = 初始分析报告\n● 第 2+ 轮 = 后续追问对话", "1");
            if (input) {
                printRangeReport(input);
            }
        });
    }

    if (printReportBtn) printReportBtn.addEventListener('click', printAIReport);

    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key.startsWith('sk-')) {
            localStorage.setItem('G_DeepSeekKey', key);
            document.getElementById('ai-key-status').style.display = 'inline';
            alert('API Key 已保存！');
        } else {
            alert('请输入有效的 DeepSeek API Key');
        }
    });

    // [!! 新增 !!] 独立的更新班级列表函数
    const updateClassList = () => {
        const subject = itemSubjectSelect.value;
        // 确保有数据
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

        // 尝试恢复之前的选择
        if (currentClass && (classes.includes(currentClass) || currentClass === 'ALL')) {
            itemClassSelect.value = currentClass;
        }
    };

    // 监听科目变化
    itemSubjectSelect.addEventListener('change', updateClassList);

    // 监听模式变化
    // 监听模式变化
    modeSelect.addEventListener('change', () => {
        const val = modeSelect.value;
        if (qCountWrapper) qCountWrapper.style.display = (val === 'question') ? 'inline-flex' : 'none';

        // [!! 修复开始 !!] 控制按钮的可用状态
        if (val === 'teaching_guide') {
            // 教师模式不需要选学生，直接激活按钮
            analyzeBtn.disabled = false;
        } else {
            // 其他模式：如果没有选过学生，则禁用按钮；如果选过（dataset有值），则保持激活
            if (searchInput.dataset.selectedId) {
                analyzeBtn.disabled = false;
            } else {
                analyzeBtn.disabled = true;
            }
        }
        // [!! 修复结束 !!]

        if (val === 'item_diagnosis' || val === 'teaching_guide') {
            itemSubjectWrapper.style.display = 'inline-flex';

            // [!!] 强制加载数据
            if (!window.G_ItemAnalysisData) {
                const stored = localStorage.getItem('G_ItemAnalysisData');
                if (stored) {
                    try {
                        window.G_ItemAnalysisData = JSON.parse(stored);
                        const cfg = localStorage.getItem('G_ItemAnalysisConfig');
                        if (cfg) window.G_ItemAnalysisConfig = JSON.parse(cfg);
                    } catch (e) { console.error(e); }
                }
            }

            // [!!] 填充科目并立即触发班级更新
            if (window.G_ItemAnalysisData) {
                const subjects = Object.keys(window.G_ItemAnalysisData);
                const currentVal = itemSubjectSelect.value;
                if (subjects.length > 0) {
                    itemSubjectSelect.innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');
                    if (currentVal && subjects.includes(currentVal)) itemSubjectSelect.value = currentVal;

                    // [!! 核心修复 !!] 手动调用一次更新班级，确保班级列表不为空
                    updateClassList();
                } else {
                    itemSubjectSelect.innerHTML = `<option value="">无数据</option>`;
                }
            } else {
                itemSubjectSelect.innerHTML = `<option value="">请先导入数据</option>`;
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

    // 搜索框逻辑 (保持不变)
    const resultsContainer = document.getElementById('ai-student-search-results');
    const multiData = await loadMultiExamData();
    const allStudentsMap = new Map();
    // 现在 multiData 是数组了，forEach 可以正常工作
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

    // 点击分析按钮
    analyzeBtn.addEventListener('click', () => {
        const studentId = searchInput.dataset.selectedId || "";
        const studentName = searchInput.dataset.selectedName || "全体同学";

        const mode = document.getElementById('ai-mode-select').value;
        const model = document.getElementById('ai-model-select').value;
        const qCount = document.getElementById('ai-q-count').value;
        const grade = document.getElementById('ai-grade-select').value;
        const targetSubject = document.getElementById('ai-item-subject').value;

        // 获取班级
        const classSelect = document.getElementById('ai-item-class');
        const targetClass = classSelect ? classSelect.value : 'ALL';

        const apiKey = localStorage.getItem('G_DeepSeekKey');
        if (!apiKey) { alert('请先设置 DeepSeek API Key'); return; }

        if (mode === 'teaching_guide' || mode === 'item_diagnosis') {
            if (!targetSubject) { alert("请选择一个科目！"); return; }

            // 再次补救数据加载
            if (!window.G_ItemAnalysisData) {
                const stored = localStorage.getItem('G_ItemAnalysisData');
                if (stored) {
                    window.G_ItemAnalysisData = JSON.parse(stored);
                    const cfg = localStorage.getItem('G_ItemAnalysisConfig');
                    if (cfg) window.G_ItemAnalysisConfig = JSON.parse(cfg);
                } else {
                    alert("无法读取数据，请先去模块13导入！"); return;
                }
            }

            if (!window.G_ItemAnalysisData[targetSubject]) {
                alert(`找不到科目【${targetSubject}】的数据。`); return;
            }

            if (mode === 'item_diagnosis' && !studentId) {
                alert('请先选择一名学生'); return;
            }
        } else {
            if (!studentId) { alert('请先选择一名学生'); return; }
        }

        runAIAnalysis(apiKey, studentId, studentName, mode, model, qCount, grade, targetSubject, targetClass);
    });

    document.getElementById('ai-copy-btn').addEventListener('click', () => {
        const content = document.getElementById('ai-content').innerText;
        navigator.clipboard.writeText(content).then(() => alert('内容已复制'));
    });
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

    // [关键] 重置当前历史记录 ID (新分析 = 新记录)
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

        // [!! 核心优化 !!] 节流渲染变量
        let lastRenderTime = 0;
        const RENDER_INTERVAL = 100; // 每 100ms 渲染一次 Markdown，防止页面闪烁

        // [!! 核心优化 !!] 智能滚屏检测
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
                            // 只有间隔超过 100ms 才重新解析 Markdown 并渲染 DOM
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

        // 生成结束，更新历史上下文
        G_AIChatHistory.push({ "role": "assistant", "content": fullContent });

        // 5. 自动保存到历史记录存档
        const modeEl = document.getElementById('ai-mode-select');
        const modeText = modeEl ? modeEl.selectedOptions[0].text : "AI分析";
        let historyTitle = `${studentName} - ${modeText}`;
        if (mode === 'teaching_guide') historyTitle = `教学指导 - ${targetSubject}`;

        // 传入 G_CurrentHistoryId (此时为 null)，返回新生成的 ID
        const newId = saveToAIHistory(historyTitle, `${grade} | ${targetSubject}`, G_CurrentHistoryId);
        G_CurrentHistoryId = newId; // 更新全局 ID

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

// 4. [最终完整版] 发送追问消息 (支持 R1 思考、单独打印、历史记录更新)
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

    // [关键] UI 状态更新：显示停止按钮，禁用发送
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

            // 手动停止时，更新历史记录
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

        // [关键] 更新历史记录 (追问内容存入 chatContent)
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
    // [!! 最终修复 !!] 移除所有的 replace 预处理
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
 * 14.1 [修复版] 打印 AI 分析报告 (包含追问记录)
 */
function printAIReport() {
    const contentDiv = document.getElementById('ai-content');
    const historyDiv = document.getElementById('ai-chat-history'); // [!!] 获取追问容器

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
    const subject = document.getElementById('ai-item-subject').value || "综合";
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

    // 2. [!! 核心修改 !!] 拼接内容：首次回答 + 追问记录
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

                /* [!!] 追问对话气泡样式 (确保打印时也能看到气泡) */
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
// [!! NEW !!] 模块十四：AI 历史记录管理器
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
        renderAIHistoryList(); // 每次打开时刷新列表
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
 * [重构版] 保存/更新 AI 对话历史
 * @param {string} title - 标题
 * @param {string} subTitle - 副标题
 * @param {number|null} existingId - 如果是更新现有记录，传入 ID；否则传 null
 */
function saveToAIHistory(title, subTitle, existingId = null) {
    const contentDiv = document.getElementById('ai-content');
    const historyDiv = document.getElementById('ai-chat-history');

    // 获取两个容器的 HTML
    const mainHtml = contentDiv ? contentDiv.innerHTML : "";
    const chatHtml = historyDiv ? historyDiv.innerHTML : "";

    if (mainHtml.trim().length < 50) return; // 内容太少不保存

    let history = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || "[]");
    let recordId = existingId;

    // 1. 构建记录对象
    const record = {
        id: existingId || Date.now(), // 有旧ID就用旧的，没有就生成新的
        timestamp: new Date().toLocaleString(),
        title: title,
        subTitle: subTitle,
        mainContent: mainHtml, // 保存主回答
        chatContent: chatHtml  // [!! NEW !!] 保存追问记录
    };

    // 2. 判断是“新增”还是“更新”
    if (existingId) {
        // --- 更新模式 ---
        const index = history.findIndex(r => r.id === existingId);
        if (index !== -1) {
            // 更新内容和时间，但保留原来的标题（也可以选择更新标题）
            history[index].timestamp = record.timestamp;
            history[index].mainContent = mainHtml;
            history[index].chatContent = chatHtml;
            // 把更新的这条置顶
            const updatedItem = history.splice(index, 1)[0];
            history.unshift(updatedItem);
        } else {
            // 没找到ID（可能被删了），变更为新增
            history.unshift(record);
            recordId = record.id;
        }
    } else {
        // --- 新增模式 ---
        history.unshift(record);
        recordId = record.id;
    }

    // 3. 限制数量并保存
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(history));

    // 4. 更新全局当前 ID
    G_CurrentHistoryId = recordId;

    // 5. 刷新侧边栏 UI
    const drawer = document.getElementById('ai-history-drawer');
    if (drawer && drawer.classList.contains('open')) {
        renderAIHistoryList();
    }

    return recordId; // 返回 ID 供调用者使用
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

        // 2. [!! NEW !!] 恢复追问记录
        const historyDiv = document.getElementById('ai-chat-history');
        if (historyDiv) {
            historyDiv.innerHTML = item.chatContent || ""; // 如果是旧数据可能没有 chatContent
        }

        // 3. 设置当前会话 ID (这样加载旧记录后，继续追问会保存在这条记录里，而不是新建)
        G_CurrentHistoryId = item.id;

        // 4. 显示容器
        document.getElementById('ai-result-container').style.display = 'block';

        // 5. 重新渲染公式
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

// [新增辅助函数] 重新绑定气泡上的打印按钮事件
function reattachPrintHandlers() {
    const printBtns = document.querySelectorAll('.ai-bubble-print-btn');
    printBtns.forEach(btn => {
        btn.onclick = function () {
            // 找到父级气泡
            const bubble = this.parentElement;
            // 提取信息 (这里需要根据你的 DOM 结构反向获取，或者简单点，不重新绑定复杂逻辑)
            // 简单的做法：重新解析 DOM 内容
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
 * [NEW] 打印单轮对话 (追问记录)
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
 * 14.2 [NEW] 范围打印功能 (按对话轮次切片)
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
// [!! NEW !!] 模块十二：多列表管理逻辑
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

            // 刷新列表显示
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
            const name = prompt("请输入新列表名称 (例如：高二下学期):");
            if (!name) return;

            const collections = await getCollections(); // [修改] await
            const newId = 'col_' + Date.now();
            collections[newId] = {
                name: name,
                exams: []
            };
            await saveCollections(collections); // [修改] await

            // 切换到新列表
            G_CurrentCollectionId = newId;
            localStorage.setItem('G_MultiExam_ActiveId', newId);

            await renderCollectionSelect(); // [修改] await

            // 刷新界面
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

            // 刷新界面
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
    // [修改] 增加 await
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
    // [修改] 增加 await，直接存对象
    await localforage.setItem(COLLECTIONS_KEY, data);
}

async function ensureCollectionsExist() {
    let collections = await getCollections(); // [修改] await

    // 如果是第一次运行新版，或者没有数据
    if (!collections || Object.keys(collections).length === 0) {
        console.log("检测到新环境，正在迁移旧数据...");

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
 * [新增] 渲染贡献度分析图 (正负条形图)
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



// [!! 新增 !!] 默认模板库
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

// [!! 在 initAIModule 中调用此函数 !!]
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
        prompts[id] = { name: "新模板", system: "", user: "" };
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
    };

    // 初始化
    renderSelect();
}

/**
 * [NEW] 模块：目标设定与规划
 */
/**
 * [NEW] 模块：目标设定与规划 (包含打印功能)
 */
function renderGoalSetting(container, activeData, stats) {
    // 1. 定义局部变量，用于暂存计算结果供打印使用
    let currentStudent = null;
    let currentTargetRank = 0;
    let currentTargetScore = 0;
    let currentStrategy = null;

    container.innerHTML = `
        <h2>🎯 目标设定与规划 (Goal Setting)</h2>
        <p style="color: var(--text-muted);">设定目标名次或分数，系统将根据学科难度和提分空间，智能规划提分路径。</p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar" style="background: transparent; padding: 0; box-shadow: none; flex-wrap: wrap;">
                
                <div class="search-combobox" style="margin-right: 20px;">
                    <label style="display:block; font-size:0.9em; color:#666; margin-bottom:5px;">1. 选择学生</label>
                    <input type="text" id="goal-student-search" placeholder="输入姓名或考号..." autocomplete="off" class="sidebar-select" style="width: 200px;">
                    <div class="search-results" id="goal-student-search-results"></div>
                </div>

                <div style="margin-right: 20px;">
                    <label style="display:block; font-size:0.9em; color:#666; margin-bottom:5px;">2. 设定目标类型</label>
                    <select id="goal-type-select" class="sidebar-select">
                        <option value="rank">目标年级排名 (名次)</option>
                        <option value="score">目标总分 (分数)</option>
                    </select>
                </div>

                <div style="margin-right: 20px;">
                    <label style="display:block; font-size:0.9em; color:#666; margin-bottom:5px;">3. 输入目标值</label>
                    <input type="number" id="goal-target-value" class="sidebar-select" style="width: 100px;" placeholder="例如: 50">
                </div>

                <div style="align-self: flex-end; display: flex; gap: 10px;">
                    <button id="goal-calc-btn" class="sidebar-button" style="background-color: var(--color-purple);">🚀 智能规划</button>
                    <button id="goal-print-btn" class="sidebar-button" style="background-color: var(--color-blue);" disabled>🖨️ 打印规划书</button>
                </div>
            </div>
        </div>

        <div id="goal-result-container" style="display: none;">
            <div class="kpi-grid" id="goal-kpi-cards"></div>
            <div class="dashboard-chart-grid-2x2">
                <div class="main-card-wrapper" style="grid-column: span 2;">
                    <h4 style="margin:0 0 15px 0;">📚 智能提分策略表</h4>
                    <div class="table-container" id="goal-strategy-table"></div>
                </div>
                <div class="main-card-wrapper">
                    <h4 style="margin:0;">📈 提分路径瀑布图</h4>
                    <div class="chart-container" id="goal-waterfall-chart" style="height: 400px;"></div>
                </div>
                <div class="main-card-wrapper">
                    <h4 style="margin:0;">🕸️ 能力现状 vs 目标模型</h4>
                    <div class="chart-container" id="goal-radar-chart" style="height: 400px;"></div>
                </div>
            </div>
        </div>
    `;

    // --- 绑定事件 ---
    const searchInput = document.getElementById('goal-student-search');
    const resultsContainer = document.getElementById('goal-student-search-results');
    const calcBtn = document.getElementById('goal-calc-btn');
    const printBtn = document.getElementById('goal-print-btn'); // [新增]

    // 搜索逻辑 (不变)
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        if (term.length < 1) { resultsContainer.style.display = 'none'; return; }
        const matches = activeData.filter(s => s.name.toLowerCase().includes(term) || String(s.id).includes(term)).slice(0, 10);
        resultsContainer.innerHTML = matches.map(s => `<div class="result-item" data-id="${s.id}" data-name="${s.name}">${s.name} (${s.id}) - 年排: ${s.gradeRank || '-'}</div>`).join('');
        resultsContainer.style.display = 'block';
    });

    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item) {
            searchInput.value = `${item.dataset.name} (${item.dataset.id})`;
            searchInput.dataset.sid = item.dataset.id;
            resultsContainer.style.display = 'none';
            printBtn.disabled = true; // 重选人后禁用打印，直到重新计算
        }
    });

    // 计算逻辑
    calcBtn.addEventListener('click', () => {
        const studentId = searchInput.dataset.sid;
        const goalType = document.getElementById('goal-type-select').value;
        const targetVal = parseFloat(document.getElementById('goal-target-value').value);

        if (!studentId) { alert("请先选择一名学生！"); return; }
        if (!targetVal) { alert("请输入目标值！"); return; }

        const student = activeData.find(s => String(s.id) === String(studentId));
        if (!student) return;

        // 计算目标分数
        let targetScore = 0;
        let targetRank = 0;

        if (goalType === 'score') {
            targetScore = targetVal;
            const sorted = [...activeData].sort((a, b) => b.totalScore - a.totalScore);
            const neighbor = sorted.find(s => s.totalScore <= targetScore);
            targetRank = neighbor ? neighbor.gradeRank : 1;
        } else {
            targetRank = targetVal;
            const sorted = [...activeData].sort((a, b) => b.totalScore - a.totalScore);
            if (targetRank <= 1) targetScore = sorted[0].totalScore;
            else if (targetRank > sorted.length) targetScore = sorted[sorted.length - 1].totalScore;
            else {
                const targetIdx = Math.min(targetRank, sorted.length) - 1;
                targetScore = sorted[targetIdx].totalScore;
            }
        }

        // 执行计算
        const strategy = calculateSmartAllocation(student, targetScore, activeData, stats);
        
        // [关键] 更新局部变量，供打印使用
        currentStudent = student;
        currentTargetScore = targetScore;
        currentTargetRank = targetRank;
        currentStrategy = strategy;
        
        // 渲染并启用打印按钮
        renderGoalResults(student, targetRank, targetScore, strategy);
        printBtn.disabled = false; // [启用按钮]
    });

    // [新增] 打印按钮点击事件
    printBtn.addEventListener('click', () => {
        if (currentStudent && currentStrategy) {
            startGoalPrintJob(currentStudent, currentTargetScore, currentTargetRank, currentStrategy);
        }
    });
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
        values.push(parseFloat(d.gain.toFixed(1))); // 增量
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
                    return { value: val, itemStyle: { color: '#6f42c1' } }; // 增量部分紫色
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
 * [NEW] 打印目标规划书 (专门的 A4 格式)
 */
function startGoalPrintJob(student, targetScore, targetRank, strategy) {
    // 1. 获取考试名称 (作为页眉)
    let examName = localStorage.getItem('G_MainFileName') || '本次考试';
    
    // 2. 排序策略数据 (提分多的在前)
    const sortedDetails = [...strategy.details].sort((a, b) => b.gain - a.gain);
    
    // 3. 计算总缺口描述
    const gap = strategy.totalDeficit;
    const gapHtml = gap > 0 
        ? `<span style="color:#dc3545; font-weight:bold;">还需提升 ${gap.toFixed(1)} 分</span>` 
        : `<span style="color:#28a745; font-weight:bold;">当前已达成目标 (溢出 ${Math.abs(gap).toFixed(1)} 分)</span>`;

    // 4. 构建打印 HTML
    const printHtml = `
    <html>
    <head>
        <title>学业目标规划书 - ${student.name}</title>
        <style>
            body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; padding: 30px; color: #333; line-height: 1.5; }
            
            /* 标题区 */
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; letter-spacing: 2px; }
            .header p { margin: 5px 0 0; color: #666; font-size: 14px; }

            /* 基本信息网格 */
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #eee; }
            .info-item { display: flex; flex-direction: column; }
            .info-label { font-size: 12px; color: #666; margin-bottom: 4px; }
            .info-value { font-size: 18px; font-weight: bold; color: #333; }
            .highlight { color: #6f42c1; }

            /* 核心表格 */
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            th, td { border: 1px solid #999; padding: 10px; text-align: center; font-size: 14px; }
            th { background-color: #f0f0f0; font-weight: bold; color: #333; }
            tr:nth-child(even) { background-color: #fcfcfc; }
            
            /* 提分列高亮 */
            .gain-cell { background-color: #f3e5f5; font-weight: bold; color: #6f42c1; font-size: 16px; }

            /* 签字区 (底部) */
            .footer-signatures { margin-top: 50px; display: flex; justify-content: space-between; page-break-inside: avoid; }
            .sign-box { width: 30%; border-top: 1px solid #333; padding-top: 10px; text-align: center; }
            .sign-label { display: block; margin-bottom: 40px; font-weight: bold; }
            
            /* 备注/口号 */
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
                <span class="info-value highlight">${targetScore.toFixed(0)} 分 / 前 ${targetRank} 名</span>
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
                    <th>目标增量 (+)</th>
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
            <div class="sign-box">
                <span class="sign-label">学生承诺</span>
                (签字)
            </div>
            <div class="sign-box">
                <span class="sign-label">家长知情</span>
                (签字)
            </div>
            <div class="sign-box">
                <span class="sign-label">班主任/导师</span>
                (签字)
            </div>
        </div>

        <div class="motto">
            "目标不是为了预测未来，而是为了指导今天的行动。"
        </div>

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