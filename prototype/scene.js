// ---------------------------------------------------------------------------
// Three.js scene wrapper: one TruckScene per canvas, rendering the truck's
// cargo box wireframe + the packed items for a chosen trip.
// Expects global THREE + THREE.OrbitControls (loaded via UMD script tags).

const couchOnlyView = new URLSearchParams(window.location.search).get("view") === "couch";
// ---------------------------------------------------------------------------

class TruckScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3f4f6);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(10, 20, 10);
    this.scene.add(dir);

    this.itemsGroup = new THREE.Group();
    this.scene.add(this.itemsGroup);
    this.truckGroup = new THREE.Group();
    this.scene.add(this.truckGroup);
    this.currentTruckId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.visibleLabels = new Set();
    this.selectedMesh = null;
    this.selectedKey = null;
    this.movingKey = null;
    this.onPlacementChange = null;
    this.onItemSelect = null;
    this.onDoneMoving = null;
    this.onLockInPlace = null;
    this.onFinishReorganizing = null;
    this.measurementGroup = new THREE.Group();
    this.scene.add(this.measurementGroup);
    this.measurementsVisible = false;
    this.canvas.addEventListener("pointerdown", (event) => this._selectItem(event));

    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._animate();
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(200, rect.width);
    const h = Math.max(200, rect.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _selectItem(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.itemsGroup.children, false).find((item) => item.object.userData.item);
    if (hit) {
      this.selectedMesh = hit.object;
      this.selectedKey = hit.object.userData.key;
      const key = hit.object.userData.key;
      if (this.visibleLabels.has(key)) this.visibleLabels.delete(key);
      else this.visibleLabels.add(key);
      hit.object.userData.label.visible = this.visibleLabels.has(key);
      this.onItemSelect?.(hit.object.userData.placement);
    }
  }

  _setObjectOpacity(object, opacity) {
    if (object.material) {
      object.userData.originalOpacity ??= object.material.opacity;
      object.material.transparent = opacity < 1 || object.material.transparent;
      object.material.opacity = opacity;
    }
    for (const child of object.children || []) this._setObjectOpacity(child, opacity);
  }

  setMovingItem(uid) {
    this.movingKey = uid;
    for (const object of this.itemsGroup.children) {
      if (object.userData?.item) {
        const opacity = object.userData.key === uid || object.userData.manual ? 1 : 0.12;
        this._setObjectOpacity(object, opacity);
        for (const companion of object.userData.companions || []) this._setObjectOpacity(companion, opacity);
      }
    }
  }

  clearMovingItem() {
    this.movingKey = null;
    for (const object of this.itemsGroup.children) {
      if (object.userData?.item) {
        this._setObjectOpacity(object, object.userData.originalOpacity ?? 1);
        for (const companion of object.userData.companions || []) this._setObjectOpacity(companion, companion.userData.originalOpacity ?? 1);
      }
    }
  }

  moveSelected(direction) {
    if (!this.selectedMesh?.userData.placement) return false;
    const step = 0.25;
    const mesh = this.selectedMesh;
    const placement = mesh.userData.placement;
    const axis = direction === "left" || direction === "right" ? "x" : "z";
    const sign = direction === "left" || direction === "forward" ? -1 : 1;
    for (let distance = step; distance <= step * 12; distance += step) {
      const position = mesh.position.clone();
      position[axis] += sign * distance;
      const accepted = this.onPlacementChange?.(placement.uid, { x: position.x, y: position.y - placement.h / 2, z: position.z }, null, { dropToFloor: true });
      if (accepted !== false) return true;
    }
    return false;
  }

  rotateSelected() {
    if (!this.selectedMesh?.userData.placement) return false;
    const mesh = this.selectedMesh;
    const placement = mesh.userData.placement;
    const dimensions = [placement.baseW, placement.baseD, placement.baseH];
    const orientationOptions = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2],
      [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ].map(([width, depth, height]) => ({
      w: dimensions[width],
      d: dimensions[depth],
      h: dimensions[height],
    })).filter((shape, index, options) => options.findIndex((other) =>
      other.w === shape.w && other.d === shape.d && other.h === shape.h) === index);
    const currentIndex = orientationOptions.findIndex((shape) => shape.w === placement.w && shape.d === placement.d && shape.h === placement.h);
    const step = 0.25;
    const offsets = [{ x: 0, z: 0 }];
    for (let radius = 1; radius <= 12; radius++) {
      for (let offset = -radius; offset <= radius; offset++) {
        offsets.push({ x: offset * step, z: -radius * step });
        offsets.push({ x: offset * step, z: radius * step });
        if (offset !== -radius && offset !== radius) {
          offsets.push({ x: -radius * step, z: offset * step });
          offsets.push({ x: radius * step, z: offset * step });
        }
      }
    }
    for (let indexOffset = 1; indexOffset <= orientationOptions.length; indexOffset++) {
      const rotated = orientationOptions[(currentIndex + indexOffset) % orientationOptions.length];
      for (const offset of offsets) {
        const accepted = this.onPlacementChange?.(placement.uid, {
          x: mesh.position.x + offset.x,
          y: mesh.position.y - placement.h / 2,
          z: mesh.position.z + offset.z,
        }, rotated);
        if (accepted !== false) return true;
      }
    }
    return false;
  }

  _label(text, color = "#111827") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(255,255,255,.92)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.font = "bold 30px Segoe UI, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text.slice(0, 27), canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(1.9, 0.36, 1);
    return sprite;
  }

  _dimensionLine(start, end, text, color = 0x92400e) {
    const group = new THREE.Group();
    const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));
    const label = this._label(text, `#${new THREE.Color(color).getHexString()}`);
    label.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
    group.add(label);
    return group;
  }

  setMeasurementsVisible(visible) {
    this.measurementsVisible = visible;
    this.measurementGroup.clear();
    if (!visible || !this.currentTruck) return;
    const truck = this.currentTruck;
    this.measurementGroup.add(this._dimensionLine([-truck.W / 2, 0.15, 0], [truck.W / 2, 0.15, 0], `${(truck.W * 12).toFixed(0)} in W`, 0x0b2447));
    this.measurementGroup.add(this._dimensionLine([truck.W / 2 + 0.2, 0, 0], [truck.W / 2 + 0.2, 0, truck.L], `${(truck.L * 12).toFixed(0)} in L`, 0x0b2447));
    this.measurementGroup.add(this._dimensionLine([truck.W / 2 + 0.35, 0, truck.L], [truck.W / 2 + 0.35, truck.H, truck.L], `${(truck.H * 12).toFixed(0)} in H`, 0x0b2447));
    const selected = this.currentPlacements.find((item) => item.uid === this.selectedKey);
    if (!selected) return;
    const x = selected.x - truck.W / 2;
    const y = selected.y;
    const z = selected.z;
    this.measurementGroup.add(this._dimensionLine([x, y + selected.h + 0.15, z], [x + selected.w, y + selected.h + 0.15, z], `${(selected.w * 12).toFixed(0)} in`));
    this.measurementGroup.add(this._dimensionLine([x + selected.w + 0.15, y, z], [x + selected.w + 0.15, y + selected.h, z], `${(selected.h * 12).toFixed(0)} in`));
    this.measurementGroup.add(this._dimensionLine([x + selected.w, y + selected.h + 0.15, z], [x + selected.w, y + selected.h + 0.15, z + selected.d], `${(selected.d * 12).toFixed(0)} in`));
  }

  _formationGuide(truck) {
    const group = new THREE.Group();
    const zones = [
      { name: "HEAVY / APPLIANCES", x: 0, width: 1, z: 0, depth: 0.2, color: 0xf28c28 },
      { name: "MATTRESSES / LEFT", x: 0, width: 0.22, z: 0, depth: 0.45, color: 0x55a66d },
      { name: "SOFAS / RIGHT", x: 0.55, width: 0.45, z: 0.2, depth: 0.45, color: 0x55a66d },
      { name: "HEAVY BOXES / CENTER", x: 0.22, width: 0.56, z: 0.35, depth: 0.35, color: 0x4b5563 },
      { name: "SMALL BOXES / REAR", x: 0.12, width: 0.76, z: 0.7, depth: 0.3, color: 0xb8bec7 },
    ];
    for (const zone of zones) {
      const depth = zone.depth * truck.L;
      const plane = new THREE.Mesh(
        new THREE.BoxGeometry(zone.width * truck.W, truck.H, depth),
        new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
      );
      plane.position.set((zone.x + zone.width / 2 - 0.5) * truck.W, truck.H / 2, zone.z * truck.L + depth / 2);
      group.add(plane);
      const label = this._label(zone.name, `#${new THREE.Color(zone.color).getHexString()}`);
      label.position.set(plane.position.x, truck.H * 0.94, plane.position.z);
      group.add(label);
    }
    return group;
  }

  _tractor(truck) {
    const group = new THREE.Group();
    const yellow = new THREE.MeshLambertMaterial({ color: 0xffc72c });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x5b8db8, transparent: true, opacity: 0.8 });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.58, truck.H * 0.5, truck.L * 0.11), yellow);
    cab.position.set(0, truck.H * 0.28, -truck.L * 0.1);
    group.add(cab);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.7, truck.H * 0.2, truck.L * 0.1), yellow);
    hood.position.set(0, truck.H * 0.12, -truck.L * 0.19);
    group.add(hood);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.45, truck.H * 0.18, 0.05), glass);
    windshield.position.set(0, truck.H * 0.43, -truck.L * 0.156);
    group.add(windshield);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.38, truck.H * 0.1, 0.05), dark);
    grille.position.set(0, truck.H * 0.13, -truck.L * 0.242);
    group.add(grille);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.78, truck.H * 0.07, truck.L * 0.035), yellow);
    bumper.position.set(0, truck.H * 0.045, -truck.L * 0.25);
    group.add(bumper);
    for (const x of [-truck.W * 0.2, truck.W * 0.2]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.1, truck.H * 0.06, 0.04), new THREE.MeshLambertMaterial({ color: 0xfff7c2 }));
      headlight.position.set(x, truck.H * 0.14, -truck.L * 0.245);
      group.add(headlight);
    }
    for (const x of [-truck.W * 0.22, truck.W * 0.22]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(truck.H * 0.09, truck.H * 0.09, truck.W * 0.08, 16), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, truck.H * 0.09, -truck.L * 0.13);
      group.add(wheel);
    }
    const coupling = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.18, truck.H * 0.08, truck.L * 0.08), dark);
    coupling.position.set(0, truck.H * 0.12, -truck.L * 0.02);
    group.add(coupling);
    for (const x of [-truck.W * 0.38, truck.W * 0.38]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(truck.W * 0.06, truck.H * 0.12, truck.L * 0.04), dark);
      mirror.position.set(x, truck.H * 0.38, -truck.L * 0.12);
      group.add(mirror);
    }
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(truck.W * 0.025, truck.W * 0.025, truck.H * 0.35, 12), dark);
    exhaust.position.set(truck.W * 0.38, truck.H * 0.3, -truck.L * 0.01);
    group.add(exhaust);
    const label = this._label("FRONT / CAB", "#b45309");
    label.position.set(0, truck.H * 0.62, -truck.L * 0.12);
    group.add(label);
    return group;
  }

  _objectModel(item, color) {
    const group = new THREE.Group();
    const isBox = item.zone === "box" || /box/i.test(item.name);
    const model = new THREE.MeshLambertMaterial({ color: isBox ? 0xf59e0b : color, transparent: true, opacity: isBox ? 1 : 0.9 });
    const accent = new THREE.MeshLambertMaterial({ color: 0x374151, transparent: true, opacity: 0.85 });
    const w = item.w * 0.78;
    const h = item.h * 0.78;
    const d = item.d * 0.72;
    const name = item.name.toLowerCase();
    if (/bookcase|book shelf/.test(name)) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), model));
      for (let i = 1; i < 4; i++) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, Math.max(0.05, h * 0.035), d * 1.03), accent);
        shelf.position.y = -h / 2 + (h / 4) * i;
        group.add(shelf);
      }
    } else if (/sofa|couch|loveseat|chaise/.test(name)) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.28, d), model);
      base.position.y = -h * 0.18;
      group.add(base);
      for (let i = -1; i <= 1; i++) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(w * 0.29, h * 0.36, d * 0.75), model);
        cushion.position.set(i * w * 0.3, h * 0.1, 0);
        group.add(cushion);
      }
    } else if (/mattress|box spring|bed/.test(name)) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.28, d), model));
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h * 0.03, d * 0.82), accent);
      stripe.position.y = h * 0.15;
      group.add(stripe);
    } else if (/table|desk/.test(name)) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.12, d), model);
      top.position.y = h * 0.25;
      group.add(top);
      for (const x of [-w * 0.38, w * 0.38]) for (const z of [-d * 0.38, d * 0.38]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.04, w * 0.06), h * 0.55, Math.max(0.04, d * 0.06)), model);
        leg.position.set(x, -h * 0.08, z);
        group.add(leg);
      }
    } else if (/chair|stool/.test(name)) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, h * 0.12, d * 0.75), model);
      seat.position.y = h * 0.05;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, h * 0.48, d * 0.08), model);
      back.position.set(0, h * 0.28, -d * 0.34);
      group.add(back);
    } else if (/refrigerator|fridge|washer|dryer|range|stove|appliance/.test(name)) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), model));
      const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, h * 0.48, d * 0.04), accent);
      door.position.set(0, h * 0.05, d * 0.5);
      group.add(door);
    } else {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), model));
    }
    return group;
  }

  // Renders the truck cargo box + a given trip's placements.
  render(truck, tripPlacements, showFormation = true, showObjectModels = true, onPlacementChange = null) {
    // clear
    this.truckGroup.clear();
    this.itemsGroup.clear();

    const { W, H, L } = truck;
    this.onPlacementChange = onPlacementChange;
    this.currentTruck = truck;
    this.currentPlacements = tripPlacements;

    // Cargo box wireframe (floor at y=0, centered on x)
    const boxGeo = new THREE.BoxGeometry(W, H, L);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111827, linewidth: 2 }));
    wire.position.set(0, H / 2, L / 2);
    this.truckGroup.add(wire);

    // translucent floor
    const floorGeo = new THREE.PlaneGeometry(W, L);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0xd1d5db, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.001, L / 2);
    this.truckGroup.add(floor);

    if (!couchOnlyView) this.truckGroup.add(this._tractor(truck));

    if (showFormation) this.truckGroup.add(this._formationGuide(truck));

    // items: our packing coords have x in [0,W] (0 = left wall), convert to centered [-W/2, W/2]
    for (const p of tripPlacements) {
      const geo = new THREE.BoxGeometry(p.w, p.h, p.d);
      const tierColors = {
        heavy: 0xf28c28,
        light: 0x2563eb,
        "light-box": 0xb8bec7,
        "heavy-box": 0x4b5563,
        soft: 0x55a66d,
        furniture: 0x2563eb,
      };
      const tierColor = tierColors[p.tier] || p.color || 0x999999;
      const mat = new THREE.MeshLambertMaterial({ color: tierColor, transparent: showObjectModels, opacity: showObjectModels ? 0.28 : 1, depthWrite: !showObjectModels });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.item = true;
      mesh.userData.key = p.uid;
      mesh.userData.placement = p;
      mesh.userData.manual = Boolean(p.manual);
      mesh.userData.originalOpacity = mat.opacity;
      mesh.userData.itemHeight = p.h;
      mesh.position.set(p.x - W / 2 + p.w / 2, p.y + p.h / 2, p.z + p.d / 2);
      this.itemsGroup.add(mesh);
      if (showObjectModels) {
        const model = this._objectModel(p, p.tier === "soft" ? 0x55a66d : 0xd1d5db);
        model.position.copy(mesh.position);
        this.itemsGroup.add(model);
        mesh.userData.companions = [model];
      }

      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeLine = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
      edgeLine.position.copy(mesh.position);
      this.itemsGroup.add(edgeLine);
      mesh.userData.companions = [...(mesh.userData.companions || []), edgeLine];

      const label = this._label(p.name, "#111827");
      label.visible = this.visibleLabels.has(p.uid);
      label.position.set(mesh.position.x, Math.min(H + 0.15, mesh.position.y + p.h / 2 + 0.25), mesh.position.z);
      this.itemsGroup.add(label);
      mesh.userData.companions.push(label);
      mesh.userData.label = label;
    }

    this.selectedMesh = this.itemsGroup.children.find((item) => item.userData?.key === this.selectedKey) || null;
    this.setMeasurementsVisible(this.measurementsVisible);

    // camera framing
    if (this.currentTruckId !== truck.id) {
      const maxDim = Math.max(W, H, L);
      if (couchOnlyView) {
        this.camera.position.set(W * 2.15, H * 1.15, L * 1.25);
      } else {
        this.camera.position.set(W * 1.6, H * 1.4 + 2, -L * 0.9);
      }
      this.controls.target.set(0, H / 3, L / 2);
      this.camera.lookAt(0, H / 3, L / 2);
      this.controls.update();
      this.camera.far = maxDim * 6;
      this.camera.updateProjectionMatrix();
      this.currentTruckId = truck.id;
    }
  }
}
