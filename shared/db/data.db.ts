import {
  DatasetStore,
  DatasetStores,
  DatasetMetadataTable,
} from "../types/db.type";

let dataStores: DatasetStores = {};
let metadataTable: DatasetMetadataTable = {};

export function getDataStores(): DatasetStores {
  return dataStores;
}

export function getMetadataTable(): DatasetMetadataTable {
  return metadataTable;
}

export function setDataStore(newDataStore: DatasetStore) {
  dataStores[newDataStore.dataset_id] = newDataStore;
}

export function setMetadataTable(newMetadataTable: DatasetMetadataTable) {
  metadataTable = newMetadataTable;
}
