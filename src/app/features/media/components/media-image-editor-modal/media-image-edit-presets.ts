/**
 * Presets de proporción y tamaño de salida para el editor de imagen.
 * Los `presetId` deben coincidir con los valores que acepta el API en POST .../edit-image.
 */
export interface MediaImageEditPresetItem {
  presetId: string;
  label: string;
  ratioLabel: string;
  aspectWidth: number;
  aspectHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export interface MediaImageEditPresetGroup {
  platform: string;
  items: MediaImageEditPresetItem[];
}

export const MEDIA_IMAGE_EDIT_PRESETS: MediaImageEditPresetGroup[] = [
  {
    platform: 'Facebook',
    items: [
      {
        presetId: 'facebook-feed-191',
        label: 'Publicar',
        ratioLabel: '1.91:1',
        aspectWidth: 1.91,
        aspectHeight: 1,
        outputWidth: 1200,
        outputHeight: 628
      },
      {
        presetId: 'facebook-featured-167',
        label: 'Destacado',
        ratioLabel: '1.67:1',
        aspectWidth: 1.67,
        aspectHeight: 1,
        outputWidth: 1200,
        outputHeight: 718
      },
      {
        presetId: 'facebook-carousel-11',
        label: 'Carrusel',
        ratioLabel: '1:1',
        aspectWidth: 1,
        aspectHeight: 1,
        outputWidth: 1080,
        outputHeight: 1080
      }
    ]
  },
  {
    platform: 'Instagram',
    items: [
      {
        presetId: 'instagram-landscape-191',
        label: 'Paisaje',
        ratioLabel: '1.91:1',
        aspectWidth: 1.91,
        aspectHeight: 1,
        outputWidth: 1080,
        outputHeight: 566
      },
      {
        presetId: 'instagram-portrait-45',
        label: 'Portarretrato',
        ratioLabel: '4:5',
        aspectWidth: 4,
        aspectHeight: 5,
        outputWidth: 1080,
        outputHeight: 1350
      },
      {
        presetId: 'instagram-standard-34',
        label: 'Standard',
        ratioLabel: '3:4',
        aspectWidth: 3,
        aspectHeight: 4,
        outputWidth: 1080,
        outputHeight: 1440
      },
      {
        presetId: 'instagram-square',
        label: 'Cuadrado',
        ratioLabel: '1:1',
        aspectWidth: 1,
        aspectHeight: 1,
        outputWidth: 1080,
        outputHeight: 1080
      }
    ]
  },
  {
    platform: 'LinkedIn',
    items: [
      {
        presetId: 'linkedin-share-191',
        label: 'Publicar',
        ratioLabel: '1.91:1',
        aspectWidth: 1.91,
        aspectHeight: 1,
        outputWidth: 1200,
        outputHeight: 627
      }
    ]
  }
];

export function defaultMediaImageEditPreset(): MediaImageEditPresetItem {
  return MEDIA_IMAGE_EDIT_PRESETS[1].items[3];
}
