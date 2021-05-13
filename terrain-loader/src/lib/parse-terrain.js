import {getMeshBoundingBox} from '@loaders.gl/loader-utils';
import Martini from '@mapbox/martini';
import Delatin from 'delatin';

function getTerrain(imageData, width, height, elevationDecoder, tesselator) {
  const {rScaler, bScaler, gScaler, offset} = elevationDecoder;

  // From Martini demo
  // https://observablehq.com/@mourner/martin-real-time-rtin-terrain-mesh
  const terrain = new Float32Array((width + 1) * (height + 1));
  // decode terrain values
  for (let i = 0, y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const k = i * 4;
      const r = imageData[k + 0];
      const g = imageData[k + 1];
      const b = imageData[k + 2];
      terrain[i + y] = r * rScaler + g * gScaler + b * bScaler + offset;
    }
  }

  if (tesselator === 'martini') {
    // backfill bottom border
    for (let i = width * (width - 1), x = 0; x < width - 1; x++, i++) {
      terrain[i] = terrain[i - width];
    }
    // backfill right border
    for (let i = height - 1, y = 0; y < height; y++, i += height) {
      terrain[i] = terrain[i - 1];
    }
  }

  return terrain;
}

function getMeshAttributes(vertices, terrain, width, height, bounds) {
  const gridSize = width + 1;
  const numOfVerticies = vertices.length / 2;
  // vec3. x, y in pixels, z in meters
  const positions = new Float32Array(numOfVerticies * 3);
  // vec2. 1 to 1 relationship with position. represents the uv on the texture image. 0,0 to 1,1.
  const texCoords = new Float32Array(numOfVerticies * 2);

  const [minX, minY, maxX, maxY] = bounds || [0, 0, width, height];
  const xScale = (maxX - minX) / width;
  const yScale = (maxY - minY) / height;

  for (let i = 0; i < numOfVerticies; i++) {
    const x = vertices[i * 2];
    const y = vertices[i * 2 + 1];
    const pixelIdx = y * gridSize + x;

    positions[3 * i + 0] = x * xScale + minX;
    positions[3 * i + 1] = -y * yScale + maxY;
    positions[3 * i + 2] = terrain[pixelIdx];

    texCoords[2 * i + 0] = x / width;
    texCoords[2 * i + 1] = y / height;
  }

  return {
    POSITION: {value: positions, size: 3},
    TEXCOORD_0: {value: texCoords, size: 2}
    // NORMAL: {}, - optional, but creates the high poly look with lighting
  };
}

/**
 * Returns generated mesh object from image data
 *
 * @param {object} terrainImage terrain image data
 * @param {object} terrainOptions terrain options
 * @returns mesh object
 */
function getMesh(terrainImage, terrainOptions) {
  if (terrainImage === null) {
    return null;
  }
  const {meshMaxError, bounds, elevationDecoder} = terrainOptions;

  const {data, width, height} = terrainImage;

  let terrain;
  let mesh;
  switch (terrainOptions.tesselator) {
    case 'martini':
      terrain = getTerrain(data, width, height, elevationDecoder, terrainOptions.tesselator);
      mesh = getMartiniTileMesh(meshMaxError, width, terrain);
      break;
    case 'delatin':
      terrain = getTerrain(data, width, height, elevationDecoder, terrainOptions.tesselator);
      mesh = getDelatinTileMesh(meshMaxError, width, height, terrain);
      break;
    // auto
    default:
      if (width === height && !(height & (width - 1))) {
        terrain = getTerrain(data, width, height, elevationDecoder, 'martini');
        mesh = getMartiniTileMesh(meshMaxError, width, terrain);
      } else {
        terrain = getTerrain(data, width, height, elevationDecoder, 'delatin');
        mesh = getDelatinTileMesh(meshMaxError, width, height, terrain);
      }
      break;
  }

  const {vertices, triangles} = mesh;
  const attributes = getMeshAttributes(vertices, terrain, width, height, bounds);

  return {
    // Data return by this loader implementation
    loaderData: {
      header: {}
    },
    header: {
      vertexCount: triangles.length,
      boundingBox: getMeshBoundingBox(attributes)
    },
    mode: 4, // TRIANGLES
    indices: {value: Uint32Array.from(triangles), size: 1},
    attributes
  };
}

/**
 * Get Martini generated vertices and triangles
 *
 * @param {number} meshMaxError threshold for simplifying mesh
 * @param {number} width width of the input data
 * @param {number[] | Float32Array} terrain elevation data
 * @returns generated vertices: Uint16Array and triangles: Uint32Array
 */
function getMartiniTileMesh(meshMaxError, width, terrain) {
  const gridSize = width + 1;
  const martini = new Martini(gridSize);
  const tile = martini.createTile(terrain);
  const {vertices, triangles} = tile.getMesh(meshMaxError);

  return {vertices, triangles};
}

/**
 * Get Delatin generated vertices and triangles
 *
 * @param {number} meshMaxError threshold for simplifying mesh
 * @param {number} width width of the input data array
 * @param {number} height height of the input data array
 * @param {number[] | Float32Array} terrain elevation data
 * @returns generated vertices: number[] and triangles number[]
 */
function getDelatinTileMesh(meshMaxError, width, height, terrain) {
  const tin = new Delatin(terrain, width + 1, height + 1);
  tin.run(meshMaxError);
  const {coords, triangles} = tin;
  const vertices = coords;
  return {vertices, triangles};
}

export default async function loadTerrain(arrayBuffer, options, context) {
  options.image = options.image || {};
  options.image.type = 'data';
  const image = await context.parse(arrayBuffer, options, options.baseUri);
  // Extend function to support additional mesh generation options (square grid or delatin)
  return getMesh(image, options.terrain);
}
