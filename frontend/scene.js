/* VECTOR demo scene — vehicle yard fixture. */
(function () {
  const vehicles = [
    { id: 1, polygon: [[760, 300], [905, 290], [910, 332], [765, 342]], score: .96, tile: 3, label: 'truck' },
    { id: 2, polygon: [[1020, 330], [1122, 334], [1118, 368], [1016, 364]], score: .93, tile: 3, label: 'car' },
    { id: 3, polygon: [[590, 665], [632, 675], [620, 803], [578, 793]], score: .91, tile: 2, label: 'truck' },
    { id: 4, polygon: [[1210, 620], [1356, 690], [1338, 730], [1192, 660]], score: .88, tile: 5, label: 'truck' },
    { id: 5, polygon: [[1440, 720], [1546, 697], [1553, 733], [1447, 756]], score: .84, tile: 6, label: 'van' },
    { id: 6, polygon: [[745, 940], [861, 946], [859, 986], [743, 980]], score: .78, tile: 4, label: 'van' },
    { id: 7, polygon: [[1030, 800], [1125, 769], [1136, 803], [1041, 834]], score: .73, tile: 5, label: 'car' },
    { id: 8, polygon: [[1510, 360], [1623, 376], [1617, 414], [1504, 398]], score: .62, tile: 7, label: 'car', edge: true },
    { id: 9, polygon: [[420, 900], [515, 887], [520, 919], [425, 932]], score: .41, tile: 1, label: 'car', low: true }
  ];

  const detections = vehicles.map(v => ({
    id: v.id,
    polygon: v.polygon,
    label: v.label,
    score: v.score,
    confidence: v.score,
    tile: v.tile,
    state: 'pending',
    origin: 'model',
    note: '',
    reasons: [
      ...(v.low ? ['低置信度'] : []),
      ...(v.edge ? ['贴边目标'] : []),
      ...(v.seam ? ['跨切片'] : [])
    ]
  }));

  window.TL_SCENE = {
    project: {
      id: 'yard-a',
      name: '车辆巡查 A 区',
      code: 'PRJ-V-0271',
      role: '车辆分析员',
      owner: 'lin.analyst',
      image: 'assets/yard.svg',
      width: 1800,
      height: 1200,
      checksum: 'c4b7e2a91d63f8057a2e0c9b41d6e3a8',
      tiles: 9,
      model: 'yolov8l-obb / vehicle-a',
      contract: 'vehicle-detection/0.2'
    },
    detections,
    tiles: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, done: false })),
    versions: [
      { id: 'v0', label: '模型原始结果', author: 'yolov8l-obb', time: '2026-11-14 09:12', readonly: true, count: detections.length, summary: '模型输出，未修订' }
    ]
  };
})();
